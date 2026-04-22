import { html } from 'lit'

function range(n) {
    return Array.from({ length: n })
}

export function skeletonFlowList(rows = 6) {
    return html`
        <div aria-busy="true" aria-label="Lädt…">
            <div class="flex flex-col lg:flex-row lg:items-center gap-2 mb-4">
                <div class="skeleton h-8 w-56 rounded"></div>
                <div class="flex items-center lg:justify-center lg:flex-1 gap-2">
                    <div class="skeleton h-7 w-12 rounded"></div>
                    <div class="skeleton h-7 w-12 rounded"></div>
                    <div class="skeleton h-7 w-16 rounded"></div>
                    <div class="skeleton h-8 w-32 rounded"></div>
                    <div class="skeleton h-8 w-32 rounded"></div>
                </div>
                <div class="hidden lg:flex items-center gap-3 flex-shrink-0">
                    <div class="skeleton h-5 w-20 rounded"></div>
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                </div>
            </div>
            <div class="flex flex-col gap-2">
                ${range(rows).map(
                    () => html`
                        <div class="rounded-box border border-base-300 bg-base-200 px-4 py-3 flex flex-col gap-2">
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex items-center gap-2 min-w-0 flex-1">
                                    <div class="skeleton h-4 w-14 rounded"></div>
                                    <div class="skeleton h-4 w-48 rounded"></div>
                                </div>
                                <div class="flex flex-col items-end gap-1 flex-shrink-0">
                                    <div class="skeleton h-3 w-36 rounded"></div>
                                    <div class="skeleton h-3 w-28 rounded"></div>
                                </div>
                            </div>
                            <div class="skeleton h-3 w-64 rounded"></div>
                            <div class="flex items-center justify-between gap-2">
                                <div class="skeleton h-3 w-40 rounded"></div>
                                <div class="skeleton h-3 w-20 rounded"></div>
                            </div>
                        </div>
                    `
                )}
            </div>
        </div>
    `
}

export function skeletonExceptionList(rows = 6) {
    return html`
        <div aria-busy="true" aria-label="Lädt…">
            <div class="flex flex-wrap items-center gap-2 mb-4">
                <div class="skeleton h-8 w-32 rounded"></div>
                <div class="skeleton h-8 w-32 rounded"></div>
                <div class="skeleton h-8 w-32 rounded"></div>
                <div class="skeleton h-8 w-32 rounded"></div>
                <div class="ml-auto flex items-center gap-3">
                    <div class="skeleton h-5 w-32 rounded"></div>
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                </div>
            </div>
            <div class="flex flex-col gap-2">
                ${range(rows).map(
                    () => html`
                        <div class="rounded-box border border-base-300 bg-base-200 px-4 py-3 flex flex-col gap-2">
                            <div class="flex items-center justify-between gap-2">
                                <div class="skeleton h-4 w-52 rounded"></div>
                                <div class="skeleton h-3 w-28 rounded"></div>
                            </div>
                            <div class="skeleton h-3 w-3/4 rounded"></div>
                            <div class="skeleton h-3 w-1/2 rounded"></div>
                        </div>
                    `
                )}
            </div>
        </div>
    `
}

export function skeletonQueueList(rows = 4) {
    return html`
        <div aria-busy="true" aria-label="Lädt…">
            <div class="flex items-center justify-between mb-4">
                <div class="skeleton h-5 w-40 rounded"></div>
                <div class="skeleton h-8 w-8 rounded-full"></div>
            </div>
            <div class="flex flex-col gap-2">
                ${range(rows).map(
                    () => html`
                        <div class="rounded-box border border-base-300 bg-base-200 px-4 py-3">
                            <div class="grid grid-cols-[1fr_auto] gap-2">
                                <div class="flex flex-col gap-1 min-w-0">
                                    <div class="skeleton h-4 w-48 rounded"></div>
                                    <div class="skeleton h-3 w-36 rounded"></div>
                                    <div class="skeleton h-3 w-24 rounded"></div>
                                </div>
                                <div class="flex flex-col items-end justify-between gap-2">
                                    <div class="skeleton h-6 w-32 rounded"></div>
                                    <div class="skeleton h-6 w-24 rounded"></div>
                                </div>
                            </div>
                        </div>
                    `
                )}
            </div>
        </div>
    `
}

export function skeletonFlowDetail() {
    return html`
        <div aria-busy="true" aria-label="Lädt…">
            <div class="flex items-center gap-2 mb-4">
                <div class="skeleton h-8 w-48 rounded"></div>
                <div class="ml-auto flex items-center gap-2">
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                </div>
            </div>
            <div class="card bg-base-200 border border-base-300 mb-4">
                <div class="card-body py-4 px-5">
                    <div class="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-3">
                        ${range(5).map(
                            () => html`
                                <div class="flex flex-col gap-1.5">
                                    <div class="skeleton h-2.5 w-14 rounded"></div>
                                    <div class="skeleton h-5 w-24 rounded"></div>
                                </div>
                            `
                        )}
                    </div>
                    <div class="mt-2 pt-2 border-t border-base-content/5">
                        <div class="skeleton h-3 w-80 rounded"></div>
                    </div>
                </div>
            </div>
            <div class="mb-4">
                <div class="flex items-center gap-2 mb-2">
                    <div class="skeleton h-4 w-16 rounded"></div>
                    <div class="skeleton h-4 w-6 rounded"></div>
                </div>
                <div class="flex gap-2 overflow-hidden p-1">
                    ${range(6).map(
                        () => html`
                            <div class="rounded-box border border-base-300 bg-base-200 px-3 py-2 flex-shrink-0 flex flex-col gap-1.5 w-36">
                                <div class="flex items-center gap-2">
                                    <div class="skeleton h-3 w-12 rounded"></div>
                                    <div class="skeleton h-3 w-8 rounded"></div>
                                </div>
                                <div class="skeleton h-3 w-28 rounded"></div>
                            </div>
                        `
                    )}
                </div>
            </div>
            <div class="mb-2">
                <div class="skeleton h-4 w-24 rounded"></div>
            </div>
            <div class="skeleton h-80 w-full rounded-box"></div>
        </div>
    `
}

export function skeletonTypeGrid(rows = 10) {
    return html`
        <div aria-busy="true" aria-label="Lädt…">
            <div class="flex items-center justify-between mb-4">
                <div class="skeleton h-5 w-56 rounded"></div>
                <div class="flex items-center gap-1">
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                ${range(rows).map(
                    () => html`
                        <div class="rounded-box border border-base-300 bg-base-200 flex flex-col">
                            <div class="px-4 pt-4 pb-3 flex items-start gap-2.5">
                                <div class="skeleton h-8 w-8 rounded-lg flex-shrink-0 mt-0.5"></div>
                                <div class="flex flex-col gap-1.5 min-w-0 flex-1">
                                    <div class="skeleton h-4 w-3/4 rounded"></div>
                                    <div class="skeleton h-3 w-1/2 rounded"></div>
                                </div>
                            </div>
                            <div class="grid grid-cols-3 divide-x divide-base-300/50 py-3 border-t border-base-300/50">
                                ${range(3).map(
                                    () => html`
                                        <div class="flex flex-col items-center gap-1.5 px-2">
                                            <div class="skeleton h-7 w-10 rounded"></div>
                                            <div class="skeleton h-3 w-12 rounded"></div>
                                        </div>
                                    `
                                )}
                            </div>
                        </div>
                    `
                )}
            </div>
        </div>
    `
}

export function skeletonOverview() {
    const kpiCard = () => html`
        <div class="rounded-box border border-base-300 bg-base-200 p-4 flex flex-col gap-3">
            <div class="flex items-start justify-between gap-3">
                <div class="skeleton h-9 w-9 rounded-xl"></div>
                <div class="skeleton h-8 w-12 rounded"></div>
            </div>
            <div class="skeleton h-3 w-24 rounded"></div>
        </div>
    `
    const chartCard = () => html`
        <div class="rounded-box border border-base-300 bg-base-200 p-3 flex flex-col gap-3">
            <div class="flex items-center justify-between">
                <div class="skeleton h-3 w-32 rounded"></div>
                <div class="skeleton h-3 w-10 rounded"></div>
            </div>
            <div class="skeleton h-40 w-full rounded"></div>
        </div>
    `
    const listCard = () => html`
        <div class="rounded-box border border-base-300 bg-base-200 p-3 flex flex-col gap-2">
            <div class="skeleton h-3 w-40 rounded mb-1"></div>
            ${range(4).map(
                () => html`
                    <div class="flex items-start gap-2 py-1.5 pl-2 pr-1 border-l-2 border-base-300">
                        <div class="flex flex-col gap-1.5 min-w-0 flex-1">
                            <div class="flex items-center gap-1.5">
                                <div class="skeleton h-3 w-28 rounded"></div>
                                <div class="skeleton h-3 w-12 rounded ml-auto"></div>
                            </div>
                            <div class="skeleton h-2.5 w-3/4 rounded"></div>
                        </div>
                    </div>
                `
            )}
        </div>
    `
    return html`
        <div aria-busy="true" aria-label="Lädt…" class="flex flex-col gap-4">
            <div class="flex items-center justify-between">
                <div class="flex flex-col gap-1.5">
                    <div class="skeleton h-5 w-32 rounded"></div>
                    <div class="skeleton h-3 w-40 rounded"></div>
                </div>
                <div class="skeleton h-9 w-9 rounded-full"></div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${range(4).map(() => kpiCard())}</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                ${chartCard()} ${chartCard()} ${listCard()} ${listCard()}
            </div>
        </div>
    `
}

export function skeletonScheduleGrid(rows = 8) {
    return html`
        <div aria-busy="true" aria-label="Lädt…">
            <div class="flex items-center gap-2 mb-4">
                <div class="skeleton h-8 w-64 rounded"></div>
                <div class="ml-auto flex items-center gap-3">
                    <div class="skeleton h-5 w-28 rounded"></div>
                    <div class="skeleton h-8 w-8 rounded-full"></div>
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                ${range(rows).map(
                    () => html`
                        <div class="rounded-box border border-base-300 bg-base-200 flex flex-col">
                            <div class="px-4 pt-4 pb-3 flex items-start gap-2.5">
                                <div class="skeleton h-8 w-8 rounded-lg flex-shrink-0 mt-0.5"></div>
                                <div class="flex flex-col gap-1.5 min-w-0 flex-1">
                                    <div class="skeleton h-4 w-3/4 rounded"></div>
                                    <div class="skeleton h-3 w-1/2 rounded"></div>
                                </div>
                            </div>
                            <div class="px-4 py-5 border-t border-base-300/50 flex flex-col items-center gap-2">
                                <div class="skeleton h-5 w-40 rounded"></div>
                                <div class="skeleton h-4 w-24 rounded"></div>
                            </div>
                            <div class="px-4 py-2 border-t border-base-300/50 flex justify-end gap-2">
                                <div class="skeleton h-5 w-14 rounded"></div>
                                <div class="skeleton h-5 w-16 rounded"></div>
                            </div>
                        </div>
                    `
                )}
            </div>
        </div>
    `
}
