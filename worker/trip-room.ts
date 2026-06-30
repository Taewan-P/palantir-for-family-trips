export class TripRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: unknown) {}

  async fetch(): Promise<Response> {
    return new Response('Expected WebSocket', { status: 426 })
  }
}
