const short = fqn => fqn?.split('\\').pop() ?? fqn

function getStepStatus(src, messages, exceptions, results) {
    if (exceptions.some(e => e.stepSource === src)) return 'error'
    const stepResults = results.filter(r => r.stepSource === src)
    if (stepResults.length > 0 && stepResults.some(r => r.result === false)) return 'rejected'
    const msgs = messages.filter(m => m.stepSource === src)
    if (msgs.some(m => m.messageType === 'finish')) return 'success'
    if (msgs.some(m => m.messageType === 'process')) return 'running'
    if (msgs.some(m => m.messageType === 'wait')) return 'waiting'
    return 'idle'
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function flattenDiff(objA, objB, prefix = '') {
    const results = []
    const keysA = objA ? Object.keys(objA) : []
    const keysB = objB ? Object.keys(objB) : []
    const allKeys = [...new Set([...keysA, ...keysB])]

    for (const key of allKeys) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        const valA = objA?.[key]
        const valB = objB?.[key]
        const inA = key in (objA ?? {})
        const inB = key in (objB ?? {})

        if (isPlainObject(valA) && isPlainObject(valB)) {
            results.push(...flattenDiff(valA, valB, fullKey))
        } else {
            const strA = JSON.stringify(valA)
            const strB = JSON.stringify(valB)
            results.push({ key: fullKey, valueA: valA, valueB: valB, changed: strA !== strB, onlyA: inA && !inB, onlyB: !inA && inB })
        }
    }
    return results
}

export function diffJson(objA, objB) {
    return flattenDiff(objA, objB)
}

export function buildRunDiff(runA, runB, steps) {
    if (!runA || !runB || !steps?.length) return []

    return steps.map(step => {
        const src = step.source
        const statusA = getStepStatus(src, runA.messages, runA.exceptions, runA.results)
        const statusB = getStepStatus(src, runB.messages, runB.exceptions, runB.results)

        const msgSourcesA = [...new Set(runA.messages.filter(m => m.stepSource === src).map(m => m.messageSource))]
        const msgSourcesB = [...new Set(runB.messages.filter(m => m.stepSource === src).map(m => m.messageSource))]
        const allMsgSources = [...new Set([...msgSourcesA, ...msgSourcesB])]

        const incomingTypes = new Set(step.messages ?? [])

        const messageDiffs = allMsgSources.map(msgSource => {
            const msgA = runA.messages.find(m => m.stepSource === src && m.messageSource === msgSource)
            const msgB = runB.messages.find(m => m.stepSource === src && m.messageSource === msgSource)
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

        const excsA = runA.exceptions.filter(e => e.stepSource === src)
        const excsB = runB.exceptions.filter(e => e.stepSource === src)

        const resultA = runA.results.find(r => r.stepSource === src)
        const resultB = runB.results.find(r => r.stepSource === src)

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
