/**
 * Generates dummy run history for a flow instance.
 * Placeholder until the real API endpoint exists.
 */

function shiftTime(iso, deltaMs) {
    return new Date(new Date(iso).getTime() + deltaMs).toISOString()
}

function tweakMessage(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return msg
    return Object.fromEntries(
        Object.entries(msg).map(([k, v]) => {
            if (typeof v === 'number') {
                const delta = Math.ceil(Math.random() * 10) * (Math.random() > 0.5 ? 1 : -1)
                return [k, +(v + delta).toFixed(2)]
            }
            if (typeof v === 'string' && /^\d+$/.test(v)) return [k, String(parseInt(v) + 1)]
            return [k, v]
        })
    )
}

export function generateDummyRuns(flow) {
    if (!flow) return []

    const msgs = flow.flowMessages ?? []
    const excs = flow.flowExceptions ?? []
    const baseTime = flow.time ?? new Date().toISOString()

    const firstStubSrc = flow.flowSchema?.stubs?.[0]?.source ?? msgs[0]?.stubSource ?? 'Unknown'

    return [
        // Run #1 — oldest, failed mid-way
        {
            runId: 'run-prev-2',
            label: 'Run #1',
            time: shiftTime(baseTime, -30 * 60_000),
            status: 'error',
            messages: msgs.slice(0, Math.max(1, Math.floor(msgs.length * 0.6))).map(m => ({
                ...m,
                message: tweakMessage(m.message),
                time: shiftTime(m.time, -30 * 60_000),
            })),
            exceptions: [
                {
                    id: 'dummy-exc-1',
                    stubSource: firstStubSrc,
                    message: 'RuntimeException: Connection timed out after 30s',
                    file: 'vendor/flowcrafter/src/Runtime/Executor.php',
                    line: 142,
                    traceString: [
                        '#0 vendor/flowcrafter/src/Runtime/Executor.php(142): execute()',
                        '#1 src/Flow.php(88): FlowCrafter\\Flow->run()',
                        '#2 public/index.php(12): App\\Flow->handle()',
                    ].join('\n'),
                    time: shiftTime(baseTime, -30 * 60_000),
                },
            ],
        },

        // Run #2 — middle, success
        {
            runId: 'run-prev-1',
            label: 'Run #2',
            time: shiftTime(baseTime, -12 * 60_000),
            status: 'success',
            messages: msgs.map(m => ({
                ...m,
                message: tweakMessage(m.message),
                time: shiftTime(m.time, -12 * 60_000),
            })),
            exceptions: [],
        },

        // Run #3 — most recent, actual API data
        {
            runId: 'run-latest',
            label: 'Run #3 (aktuell)',
            time: baseTime,
            status: excs.length > 0 ? 'error' : 'success',
            messages: msgs,
            exceptions: excs,
        },
    ]
}
