export const AUTH_TOKEN = 'test-token-123'

export const authStatus = {
    hasPassword: true,
    authenticated: false,
}

export const authStatusAuthenticated = {
    hasPassword: true,
    authenticated: true,
}

export const authStatusNoPassword = {
    hasPassword: false,
    authenticated: false,
}

export const loginSuccess = {
    token: AUTH_TOKEN,
}

export const loginError = {
    error: 'Falsches Passwort.',
}

export const setupSuccess = {
    token: AUTH_TOKEN,
}

export const connectionConfigured = {
    configured: true,
    url: 'http://localhost:8000',
    secret: '',
}

export const connectionNotConfigured = {
    configured: false,
    url: '',
    secret: '',
}

export const pingSuccess = {
    ok: true,
}

export const pingUnauthorized = {
    error: '401',
}

export const aiConfigUnconfigured = {
    configured: false,
    model: null,
    provider: 'anthropic',
    anthropicModels: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'anthropic' },
        { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', provider: 'anthropic' },
    ],
}

export const serverInfo = {
    version: '0.18.3',
    workerCount: 2,
    workers: [
        { id: 1, heartbeat: new Date().toISOString() },
        { id: 2, heartbeat: new Date().toISOString() },
    ],
}

export const uiVersion = {
    version: '0.18.3',
}

export const flowList = {
    total: 3,
    items: [
        {
            flowHash: 'abc123',
            flowSource: 'App\\Flow\\OrderFlow',
            flowRuntimeHash: 'rt-001',
            status: 'OK',
            createdAt: '2026-05-14T10:00:00+00:00',
            updatedAt: '2026-05-14T10:01:00+00:00',
        },
        {
            flowHash: 'def456',
            flowSource: 'App\\Flow\\PaymentFlow',
            flowRuntimeHash: 'rt-002',
            status: 'FAILED',
            createdAt: '2026-05-14T09:00:00+00:00',
            updatedAt: '2026-05-14T09:05:00+00:00',
        },
        {
            flowHash: 'ghi789',
            flowSource: 'App\\Flow\\NotificationFlow',
            flowRuntimeHash: 'rt-003',
            status: 'OK',
            createdAt: '2026-05-14T08:00:00+00:00',
            updatedAt: '2026-05-14T08:02:00+00:00',
        },
    ],
}

export const flowDetail = {
    flowHash: 'abc123',
    flowSource: 'App\\Flow\\OrderFlow',
    flowRuntimeHash: 'rt-001',
    status: 'OK',
    createdAt: '2026-05-14T10:00:00+00:00',
    updatedAt: '2026-05-14T10:01:00+00:00',
    messageSource: 'App\\Message\\OrderMessage',
    steps: [
        { stepHash: 's1', stepSource: 'App\\Step\\ValidateOrder', sort: 1 },
        { stepHash: 's2', stepSource: 'App\\Step\\ProcessPayment', sort: 2 },
    ],
    messages: [
        {
            flowHash: 'abc123',
            flowRuntimeHash: 'rt-001',
            stepHash: 's1',
            stepSource: 'App\\Step\\ValidateOrder',
            message: '{"orderId": 42}',
            createdAt: '2026-05-14T10:00:10+00:00',
        },
    ],
    exceptions: [],
    results: [{ flowHash: 'abc123', flowRuntimeHash: 'rt-001', stepHash: 's1', result: true }],
}

export const exceptionList = {
    total: 2,
    hasMore: false,
    items: [
        {
            id: 1,
            flowHash: 'def456',
            flowSource: 'App\\Flow\\PaymentFlow',
            flowRuntimeHash: 'rt-002',
            flowStatus: 'FAILED',
            stepSource: 'App\\Step\\ProcessPayment',
            type: 'flow',
            status: 'FAILED',
            message: 'Payment gateway timeout',
            file: '/app/src/Step/ProcessPayment.php',
            line: 42,
            createdAt: '2026-05-14T09:03:00+00:00',
        },
        {
            id: 2,
            flowHash: 'ghi789',
            flowSource: 'App\\Flow\\NotificationFlow',
            flowRuntimeHash: 'rt-003',
            flowStatus: 'FAILED',
            stepSource: 'App\\Step\\SendEmail',
            type: 'flow',
            status: 'FAILED',
            message: 'SMTP connection refused',
            file: '/app/src/Step/SendEmail.php',
            line: 18,
            createdAt: '2026-05-14T08:30:00+00:00',
        },
    ],
}

export const exceptionStats = {
    total: 2,
    byDay: [{ date: '2026-05-14', count: 2 }],
}

export const queueList = [
    {
        queueId: 1,
        flowHash: 'abc123',
        flowSource: 'App\\Flow\\OrderFlow',
        messageSource: 'App\\Message\\OrderMessage',
        message: { orderId: 99 },
        createdAt: '2026-05-14T11:00:00+00:00',
    },
]

export const queueCount = {
    count: 1,
}

export const flowStats = {
    total: 10,
    byDay: [
        { date: '2026-05-13', count: 4 },
        { date: '2026-05-14', count: 6 },
    ],
}

export const flowTypeStats = [
    { prefix: 'App\\Flow\\OrderFlow', group: null, total: 5, successRate: 100 },
    { prefix: 'App\\Flow\\PaymentFlow', group: null, total: 3, successRate: 66.7 },
    { prefix: 'App\\Flow\\NotificationFlow', group: null, total: 2, successRate: 100 },
]

export const projections = {}

export const schemas = {
    schemas: [],
}

export const overviewStats = {
    flowCount: 10,
    exceptionCount: 2,
    queueCount: 1,
}

export const scheduleList = []

export const searchResults = {
    items: [],
}
