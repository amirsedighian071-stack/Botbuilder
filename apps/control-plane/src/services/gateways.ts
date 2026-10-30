import { AppError, toErrorMessage } from '@botforge/core';

export type DeployProvider = 'cloudflare' | 'railway';

export interface CloudflareCredentials {
  apiToken: string;
  accountId?: string;
}

export interface RailwayCredentials {
  apiToken: string;
  projectName?: string;
  databaseUrl?: string;
}

export interface ProviderValidation {
  provider: DeployProvider;
  ok: boolean;
  accountId?: string;
  accountName?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GatewayOptions {
  cloudflareApiBase: string;
  railwayApiUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: T;
}

interface RailwayEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

export class ProviderGatewayError extends AppError {
  constructor(provider: string, message: string, details?: unknown) {
    super('UPSTREAM_ERROR', `${provider}: ${message}`, { details });
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ProviderGateways {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? 'زمان پاسخ سرویس به پایان رسید' : toErrorMessage(error);
      throw new ProviderGatewayError('network', message);
    } finally {
      clearTimeout(timer);
    }
  }

  private async cloudflare<T>(
    path: string,
    init: { method?: string; body?: unknown; token: string; headers?: Record<string, string> },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${init.token}`,
      Accept: 'application/json',
      ...(init.headers ?? {}),
    };
    let body: string | FormData | undefined;
    if (init.body instanceof FormData) {
      body = init.body;
    } else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const response = await this.request(joinUrl(this.options.cloudflareApiBase, path), {
      method: init.method ?? 'GET',
      headers,
      body,
    });
    const text = await response.text();
    let parsed: CloudflareEnvelope<T> | null = null;
    try {
      parsed = text.length > 0 ? (JSON.parse(text) as CloudflareEnvelope<T>) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok || !parsed || parsed.success === false) {
      const reason =
        parsed?.errors?.map((error) => error.message).filter(Boolean).join('; ') ||
        text.slice(0, 300) ||
        `HTTP ${response.status}`;
      throw new ProviderGatewayError('Cloudflare', reason, { status: response.status });
    }
    return parsed.result;
  }

  async validateCloudflare(credentials: CloudflareCredentials): Promise<ProviderValidation> {
    const token = credentials.apiToken.trim();
    if (token.length < 20) {
      return { provider: 'cloudflare', ok: false, message: 'توکن Cloudflare کوتاه‌تر از حد انتظار است.' };
    }
    const accounts = await this.cloudflare<Array<{ id: string; name: string }>>('/accounts', { token });
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return {
        provider: 'cloudflare',
        ok: false,
        message: 'هیچ حساب Cloudflare با این توکن در دسترس نیست. دسترسی Account Read و Workers Scripts را فعال کنید.',
      };
    }
    const chosen = credentials.accountId
      ? accounts.find((account) => account.id === credentials.accountId)
      : accounts[0];
    if (!chosen) {
      return {
        provider: 'cloudflare',
        ok: false,
        message: 'حساب انتخاب‌شده در دسترس این توکن نیست.',
      };
    }
    return {
      provider: 'cloudflare',
      ok: true,
      accountId: chosen.id,
      accountName: chosen.name,
      message: `توکن معتبر است؛ حساب «${chosen.name}» انتخاب شد.`,
      details: { accounts: accounts.map((account) => ({ id: account.id, name: account.name })) },
    };
  }

  async cloudflareSubdomain(accountId: string, token: string): Promise<string> {
    const result = await this.cloudflare<{ subdomain: string }>(`/accounts/${accountId}/workers/subdomain`, { token });
    if (!result.subdomain) throw new ProviderGatewayError('Cloudflare', 'زیردامنه workers.dev برای این حساب فعال نیست');
    return result.subdomain;
  }

  async cloudflareEnsureDatabase(
    accountId: string,
    token: string,
    name: string,
    statements: string[],
  ): Promise<{ id: string; name: string; created: boolean }> {
    const existing = await this.cloudflare<Array<{ uuid: string; name: string; version?: string }>>(
      `/accounts/${accountId}/d1/database`,
      { token },
    );
    const found = (existing ?? []).find((database) => database.name === name);
    let databaseId = found?.uuid ?? '';
    let created = false;
    if (!databaseId) {
      const createdDatabase = await this.cloudflare<{ uuid: string; name: string }>(`/accounts/${accountId}/d1/database`, {
        method: 'POST',
        token,
        body: { name },
      });
      databaseId = createdDatabase.uuid;
      created = true;
    }
    for (const statement of statements) {
      await this.cloudflare<unknown>(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
        method: 'POST',
        token,
        body: { sql: statement },
      });
    }
    return { id: databaseId, name, created };
  }

  async cloudflareUploadWorker(input: {
    accountId: string;
    token: string;
    scriptName: string;
    moduleCode: string;
    d1DatabaseId: string;
    variables: Record<string, string>;
    secrets: Record<string, string>;
    cron: string;
  }): Promise<{ scriptName: string; url: string }> {
    const { accountId, token, scriptName } = input;
    const metadata = {
      main_module: 'index.js',
      compatibility_date: '2025-01-15',
      compatibility_flags: ['nodejs_compat'],
      bindings: [
        { type: 'd1', name: 'DB', id: input.d1DatabaseId },
        ...Object.entries(input.variables).map(([name, text]) => ({ type: 'plain_text', name, text })),
      ],
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append(
      'index.js',
      new Blob([input.moduleCode], { type: 'application/javascript+module' }),
      'index.js',
    );
    await this.cloudflare(`/accounts/${accountId}/workers/scripts/${scriptName}`, {
      method: 'PUT',
      token,
      body: form,
    });

    for (const [name, text] of Object.entries(input.secrets)) {
      await this.cloudflare(`/accounts/${accountId}/workers/scripts/${scriptName}/secrets`, {
        method: 'PUT',
        token,
        body: { name, text, type: 'secret_text' },
      });
    }

    await this.cloudflare(`/accounts/${accountId}/workers/scripts/${scriptName}/schedules`, {
      method: 'PUT',
      token,
      body: { crons: [input.cron] },
    });

    await this.cloudflare(`/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
      method: 'POST',
      token,
      body: { enabled: true, previews_enabled: false },
    });

    const subdomain = await this.cloudflareSubdomain(accountId, token);
    return { scriptName, url: `https://${scriptName}.${subdomain}.workers.dev` };
  }

  private async railway<T>(
    query: string,
    variables: Record<string, unknown>,
    token: string,
  ): Promise<T> {
    const response = await this.request(this.options.railwayApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    let parsed: RailwayEnvelope<T> | null = null;
    try {
      parsed = text.length > 0 ? (JSON.parse(text) as RailwayEnvelope<T>) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok || !parsed) {
      throw new ProviderGatewayError('Railway', text.slice(0, 300) || `HTTP ${response.status}`);
    }
    if (parsed.errors && parsed.errors.length > 0) {
      throw new ProviderGatewayError(
        'Railway',
        parsed.errors.map((error) => error.message).join('; '),
        parsed.errors,
      );
    }
    if (parsed.data === undefined) throw new ProviderGatewayError('Railway', 'پاسخ خالی از سرویس Railway');
    return parsed.data;
  }

  async validateRailway(credentials: RailwayCredentials): Promise<ProviderValidation> {
    const token = credentials.apiToken.trim();
    if (token.length < 20) {
      return { provider: 'railway', ok: false, message: 'توکن Railway کوتاه‌تر از حد انتظار است.' };
    }
    const data = await this.railway<{ me: { id: string; name: string; email?: string } | null }>(
      'query Me { me { id name email } }',
      {},
      token,
    );
    if (!data.me) {
      return { provider: 'railway', ok: false, message: 'توکن Railway معتبر نیست یا منقضی شده است.' };
    }
    return {
      provider: 'railway',
      ok: true,
      accountId: data.me.id,
      accountName: data.me.name,
      message: `توکن Railway معتبر است؛ حساب «${data.me.name}» شناسایی شد.`,
      details: { email: data.me.email ?? null },
    };
  }

  async railwayProject(token: string, name: string): Promise<{ id: string; name: string; environmentId: string }> {
    const created = await this.railway<{ projectCreate: { id: string; name: string; environments: { edges: Array<{ node: { id: string; name: string } }> } } }>(
      `mutation CreateProject($input: ProjectCreateInput!) {
        projectCreate(input: $input) { id name environments { edges { node { id name } } } }
      }`,
      { input: { name } },
      token,
    );
    const project = created.projectCreate;
    const environment = project.environments.edges[0]?.node;
    if (!environment) throw new ProviderGatewayError('Railway', 'محیط production برای پروژه ساخته نشد');
    return { id: project.id, name: project.name, environmentId: environment.id };
  }

  async railwayService(
    token: string,
    input: { projectId: string; name: string; repo: string },
  ): Promise<{ id: string; name: string }> {
    const data = await this.railway<{ serviceCreate: { id: string; name: string } }>(
      `mutation CreateService($input: ServiceCreateInput!) {
        serviceCreate(input: $input) { id name }
      }`,
      { input: { projectId: input.projectId, name: input.name, source: { repo: input.repo } } },
      token,
    );
    return data.serviceCreate;
  }

  async railwayVariables(
    token: string,
    input: { projectId: string; environmentId: string; serviceId: string; variables: Record<string, string> },
  ): Promise<void> {
    await this.railway<{ variableCollectionUpsert: boolean }>(
      `mutation SetVars($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }`,
      {
        input: {
          projectId: input.projectId,
          environmentId: input.environmentId,
          serviceId: input.serviceId,
          variables: input.variables,
        },
      },
      token,
    );
  }

  async railwayDomain(token: string, input: { environmentId: string; serviceId: string }): Promise<string> {
    const data = await this.railway<{ serviceDomainCreate: { domain: string } }>(
      `mutation CreateDomain($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { domain }
      }`,
      { input: { environmentId: input.environmentId, serviceId: input.serviceId, targetPort: 8080 } },
      token,
    );
    const domain = data.serviceDomainCreate.domain.replace(/^https?:\/\//, '');
    return `https://${domain}`;
  }

  async railwayDeploymentStatus(
    token: string,
    input: { projectId: string; environmentId: string; serviceId: string },
  ): Promise<{ status: string; id: string; createdAt: string } | null> {
    const data = await this.railway<{
      deployments: { edges: Array<{ node: { id: string; status: string; createdAt: string } }> };
    }>(
      `query Deployments($input: DeploymentListInput!) {
        deployments(input: $input) { edges { node { id status createdAt } } }
      }`,
      { input: { projectId: input.projectId, environmentId: input.environmentId, serviceId: input.serviceId } },
      token,
    );
    const node = data.deployments.edges[0]?.node;
    return node ? { status: node.status, id: node.id, createdAt: node.createdAt } : null;
  }

  async railwayRedeploy(token: string, input: { serviceId: string; environmentId: string }): Promise<void> {
    await this.railway<{ serviceInstanceDeployV2: string }>(
      `mutation Redeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId: input.serviceId, environmentId: input.environmentId },
      token,
    );
  }
}

export function createProviderGateways(options: GatewayOptions): ProviderGateways {
  return new ProviderGateways(options);
}
