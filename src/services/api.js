import { connection } from './connection.js'

function fetchJson(path) {
    const secret = connection.getSecret()
    const headers = secret ? { Authorization: `Bearer ${secret}` } : {}
    return fetch(`${connection.getUrl()}${path}`, { headers }).then(async res => {
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json()
    })
}

function postJson(path, body) {
    const secret = connection.getSecret()
    const headers = {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    }
    return fetch(`${connection.getUrl()}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    }).then(async res => {
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error ?? `HTTP ${res.status}`)
        }
        return res.json()
    })
}

export const api = {
    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, type?: string, from?: string, to?: string }} [opts] */
    getFlows({ sort = 'desc', top = 1000, skip = 0, type, from, to } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (type) p.set('type', type)
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        return fetchJson(`/api/flows?${p}`)
    },

    /** @param {string} hash */
    getFlow(hash) {
        return fetchJson(`/api/flows/detail?hash=${encodeURIComponent(hash)}`)
    },

    /** @param {string} runtimeHash */
    getFlowByRuntimeHash(runtimeHash) {
        return fetchJson(`/api/flows/detail?runtimeHash=${encodeURIComponent(runtimeHash)}`)
    },

    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, flowHash?: string, from?: string, to?: string }} [opts] */
    getExceptions({ sort = 'desc', top = 1000, skip = 0, flowHash, from, to } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (flowHash) p.set('flowHash', flowHash)
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        return fetchJson(`/api/exceptions?${p}`)
    },

    /**
     * @param {string} flowHash
     * @param {string} messageSource  fully-qualified class name
     * @param {object} message        plain object (will be sent as JSON)
     */
    runFlow(flowHash, messageSource, message) {
        return postJson('/api/flows/run', { flowHash, messageSource, message })
    },

    /** @param {{ sort?: 'asc'|'desc' }} [opts] */
    getQueues({ sort = 'desc' } = {}) {
        const p = new URLSearchParams({ sort })
        return fetchJson(`/api/queues?${p}`)
    },

    queueFlow(flowHash, messageSource, message) {
        return postJson('/api/queue', { flowHash, messageSource, message })
    },

    getQueueCount() {
        return fetchJson('/api/queue/count')
    },

    getInfo() {
        return fetchJson('/api/info')
    },

    /** @param {string} className */
    getStubSource(_className) {
        // TODO: replace with fetchJson(`/api/stubs/source?class=${encodeURIComponent(className)}`)
        return Promise.resolve({
            source: `<?php

declare(strict_types=1);

namespace Tests\\MockClass;

use Flowcrafter\\Stub\\PostStub;
use Flowcrafter\\Message\\Message;

final class PostStubMock extends PostStub
{
    public function __invoke(Message $message): Message
    {
        $data = $message->payload();

        // validate required fields
        if (!isset($data['id'])) {
            throw new \\InvalidArgumentException('Missing required field: id');
        }

        return $message->withPayload([
            ...$data,
            'processed' => true,
            'processedAt' => (new \\DateTimeImmutable())->format('c'),
        ]);
    }
}
`,
        })
    },

    /** @returns {Promise<Array>} mock schema data */
    getSchemas() {
        return Promise.resolve([
            {
                flowType: 'flow.order.create.v1',
                stubs: [
                    { source: 'App\\Stubs\\ValidateInput', messageEnum: 'init' },
                    { source: 'App\\Stubs\\CreateOrder', messageEnum: 'data' },
                    { source: 'App\\Stubs\\SendNotification', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.order.update.v1',
                stubs: [
                    { source: 'App\\Stubs\\ValidateInput', messageEnum: 'init' },
                    { source: 'App\\Stubs\\UpdateOrder', messageEnum: 'data' },
                    { source: 'App\\Stubs\\WriteAuditLog', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.order.cancel.v1',
                stubs: [
                    { source: 'App\\Stubs\\CancelOrder', messageEnum: 'init' },
                    { source: 'App\\Stubs\\ProcessRefund', messageEnum: 'data' },
                    { source: 'App\\Stubs\\SendNotification', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.invoice.generate.v1',
                stubs: [
                    { source: 'App\\Stubs\\GenerateInvoice', messageEnum: 'init' },
                    { source: 'App\\Stubs\\CalculateTax', messageEnum: 'data' },
                    { source: 'App\\Stubs\\StorePdf', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.invoice.send.v1',
                stubs: [
                    { source: 'App\\Stubs\\LoadInvoice', messageEnum: 'init' },
                    { source: 'App\\Stubs\\SendEmail', messageEnum: 'data' },
                    { source: 'App\\Stubs\\WriteAuditLog', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.payment.process.v1',
                stubs: [
                    { source: 'App\\Stubs\\ValidateInput', messageEnum: 'init' },
                    { source: 'App\\Stubs\\ChargeGateway', messageEnum: 'data' },
                    { source: 'App\\Stubs\\RecordTransaction', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.payment.refund.v1',
                stubs: [
                    { source: 'App\\Stubs\\ProcessRefund', messageEnum: 'init' },
                    { source: 'App\\Stubs\\ReverseCharge', messageEnum: 'data' },
                    { source: 'App\\Stubs\\RecordTransaction', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.user.register.v1',
                stubs: [
                    { source: 'App\\Stubs\\ValidateInput', messageEnum: 'init' },
                    { source: 'App\\Stubs\\CreateUser', messageEnum: 'data' },
                    { source: 'App\\Stubs\\SendEmail', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.user.deactivate.v1',
                stubs: [
                    { source: 'App\\Stubs\\DeactivateUser', messageEnum: 'init' },
                    { source: 'App\\Stubs\\AnonymizeData', messageEnum: 'data' },
                    { source: 'App\\Stubs\\SendNotification', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.shipping.create.v1',
                stubs: [
                    { source: 'App\\Stubs\\CreateShipment', messageEnum: 'init' },
                    { source: 'App\\Stubs\\BookCarrier', messageEnum: 'data' },
                    { source: 'App\\Stubs\\PrintLabel', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.shipping.track.v1',
                stubs: [
                    { source: 'App\\Stubs\\PollTracking', messageEnum: 'init' },
                    { source: 'App\\Stubs\\UpdateShipmentStatus', messageEnum: 'data' },
                    { source: 'App\\Stubs\\SendNotification', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.product.import.v1',
                stubs: [
                    { source: 'App\\Stubs\\ParseCsv', messageEnum: 'init' },
                    { source: 'App\\Stubs\\UpsertProduct', messageEnum: 'data' },
                    { source: 'App\\Stubs\\IndexSearch', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.newsletter.subscribe.v1',
                stubs: [
                    { source: 'App\\Stubs\\ValidateEmail', messageEnum: 'init' },
                    { source: 'App\\Stubs\\AddSubscriber', messageEnum: 'data' },
                    { source: 'App\\Stubs\\SendEmail', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.support.ticket.v1',
                stubs: [
                    { source: 'App\\Stubs\\CreateTicket', messageEnum: 'init' },
                    { source: 'App\\Stubs\\AssignAgent', messageEnum: 'data' },
                    { source: 'App\\Stubs\\SendNotification', messageEnum: 'return' },
                ],
            },
            {
                flowType: 'flow.warehouse.receive.v1',
                stubs: [
                    { source: 'App\\Stubs\\ScanBarcode', messageEnum: 'init' },
                    { source: 'App\\Stubs\\UpdateInventory', messageEnum: 'data' },
                    { source: 'App\\Stubs\\WriteAuditLog', messageEnum: 'return' },
                ],
            },
        ])
    },
}
