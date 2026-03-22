const short = fqn => fqn?.split('\\').pop() ?? fqn

function getStubStatus(src, messages, exceptions, results) {
    if (exceptions.some(e => e.stubSource === src)) return 'error'
    const stubResults = results.filter(r => r.stubSource === src)
    if (stubResults.length > 0 && stubResults.some(r => r.result === false)) return 'rejected'
    const msgs = messages.filter(m => m.stubSource === src)
    if (msgs.some(m => m.messageType === 'finish')) return 'success'
    if (msgs.some(m => m.messageType === 'process')) return 'running'
    if (msgs.some(m => m.messageType === 'wait')) return 'waiting'
    return 'idle'
}

export function diffJson(objA, objB) {
    const keysA = objA ? Object.keys(objA) : []
    const keysB = objB ? Object.keys(objB) : []
    const allKeys = [...new Set([...keysA, ...keysB])]
    return allKeys.map(key => {
        const valA = objA?.[key]
        const valB = objB?.[key]
        const strA = JSON.stringify(valA)
        const strB = JSON.stringify(valB)
        return { key, valueA: valA, valueB: valB, changed: strA !== strB, onlyA: !(key in (objB ?? {})), onlyB: !(key in (objA ?? {})) }
    })
}

export function buildRunDiff(runA, runB, stubs) {
    if (!runA || !runB || !stubs?.length) return []

    return stubs.map(stub => {
        const src = stub.source
        const statusA = getStubStatus(src, runA.messages, runA.exceptions, runA.results)
        const statusB = getStubStatus(src, runB.messages, runB.exceptions, runB.results)

        const msgSourcesA = [...new Set(runA.messages.filter(m => m.stubSource === src).map(m => m.messageSource))]
        const msgSourcesB = [...new Set(runB.messages.filter(m => m.stubSource === src).map(m => m.messageSource))]
        const allMsgSources = [...new Set([...msgSourcesA, ...msgSourcesB])]

        const incomingTypes = new Set(stub.messages ?? [])

        const messageDiffs = allMsgSources.map(msgSource => {
            const msgA = runA.messages.find(m => m.stubSource === src && m.messageSource === msgSource)
            const msgB = runB.messages.find(m => m.stubSource === src && m.messageSource === msgSource)
            return {
                messageSource: msgSource,
                shortName: short(msgSource),
                direction: incomingTypes.has(msgSource) ? 'in' : 'out',
                onlyA: !!msgA && !msgB,
                onlyB: !msgA && !!msgB,
                payloadDiff: diffJson(msgA?.message, msgB?.message),
                hasChanges: JSON.stringify(msgA?.message) !== JSON.stringify(msgB?.message),
            }
        })

        const excsA = runA.exceptions.filter(e => e.stubSource === src)
        const excsB = runB.exceptions.filter(e => e.stubSource === src)

        const resultA = runA.results.find(r => r.stubSource === src)
        const resultB = runB.results.find(r => r.stubSource === src)

        const hasChanges =
            statusA !== statusB ||
            messageDiffs.some(d => d.hasChanges) ||
            excsA.length !== excsB.length ||
            JSON.stringify(resultA?.result) !== JSON.stringify(resultB?.result)

        return {
            source: src,
            shortName: short(src),
            statusA,
            statusB,
            statusChanged: statusA !== statusB,
            messageDiffs,
            exceptionsA: excsA,
            exceptionsB: excsB,
            resultA: resultA ?? null,
            resultB: resultB ?? null,
            resultChanged: JSON.stringify(resultA?.result) !== JSON.stringify(resultB?.result),
            hasChanges,
        }
    })
}
