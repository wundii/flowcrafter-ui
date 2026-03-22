const byTime = (a, b) => new Date(a.time) - new Date(b.time)

/**
 * Builds run list from real API flow data.
 * Each run groups its messages and exceptions by flowRuntimeHash.
 * Runs, messages and exceptions are sorted ascending by time.
 */
export function buildRuns(flow) {
    if (!flow?.flowRuns?.length) return []

    const msgs = flow.flowMessages ?? []
    const excs = flow.flowExceptions ?? []
    const ress = flow.flowResults ?? []

    const sortedRuns = [...flow.flowRuns].sort(byTime)

    return sortedRuns.map((run, i) => {
        const runtimeHash = run.flowRuntimeHash
        const runMessages = msgs.filter(m => m.flowRuntimeHash === runtimeHash).sort(byTime)
        const runExceptions = excs.filter(e => e.flowRuntimeHash === runtimeHash).sort(byTime)
        const runResults = ress.filter(r => r.flowRuntimeHash === runtimeHash).sort(byTime)

        return {
            runId: runtimeHash,
            label: `Run #${i + 1}`,
            time: run.time,
            queueId: run.queueId ?? null,
            status: runExceptions.length > 0 ? 'error' : 'success',
            messages: runMessages,
            exceptions: runExceptions,
            results: runResults,
        }
    })
}
