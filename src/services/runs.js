/**
 * Builds run list from real API flow data.
 * Each run groups its messages and exceptions by flowRuntimeHash.
 */
export function buildRuns(flow) {
    if (!flow?.flowRuns?.length) return []

    const msgs = flow.flowMessages ?? []
    const excs = flow.flowExceptions ?? []

    return flow.flowRuns.map((run, i) => {
        const runtimeHash = run.flowRuntimeHash
        const runMessages = msgs.filter(m => m.flowRuntimeHash === runtimeHash)
        const runExceptions = excs.filter(e => e.flowRuntimeHash === runtimeHash)

        return {
            runId: runtimeHash,
            label: `Run #${i + 1}`,
            time: run.time,
            queueId: run.queueId ?? null,
            status: runExceptions.length > 0 ? 'error' : 'success',
            messages: runMessages,
            exceptions: runExceptions,
        }
    })
}
