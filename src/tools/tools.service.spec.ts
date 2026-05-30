import { ToolsService } from './tools.service';

describe('ToolsService MCP metadata', () => {
  function createService() {
    return new ToolsService(
      {
        definitions: [
          {
            name: 'get_my_bookings',
            description: 'List bookings',
            input_schema: { type: 'object', properties: {}, required: [] },
          },
          {
            name: 'book_room',
            description: 'Book a room',
            input_schema: { type: 'object', properties: {}, required: [] },
          },
        ],
        execute: jest.fn(),
      } as never,
      {
        definitions: [
          {
            name: 'get_current_time',
            description: 'Read current time',
            input_schema: { type: 'object', properties: {}, required: [] },
          },
        ],
        execute: jest.fn(),
      } as never,
      {
        toolExecutionsTotal: {
          inc: jest.fn(),
        },
      } as never,
    );
  }

  it('keeps Anthropic definitions free of MCP-only metadata', () => {
    const definitions = createService().getDefinitions();

    expect(definitions).toEqual([
      expect.objectContaining({ name: 'get_my_bookings' }),
      expect.objectContaining({ name: 'book_room' }),
      expect.objectContaining({ name: 'get_current_time' }),
    ]);
    expect(definitions[0]).not.toHaveProperty('annotations');
    expect(definitions[0]).not.toHaveProperty('outputSchema');
  });

  it('adds MCP annotations and output schemas for clients', () => {
    const definitions = createService().getMcpDefinitions();
    const bookings = definitions.find(
      (tool) => tool.name === 'get_my_bookings',
    );
    const bookRoom = definitions.find((tool) => tool.name === 'book_room');

    expect(bookings).toMatchObject({
      title: 'Get My Bookings',
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: { type: 'object', additionalProperties: true },
    });
    expect(bookRoom).toMatchObject({
      title: 'Book Room',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    });
  });

  it('wraps non-object results as structured content', () => {
    const service = createService();

    expect(service.toStructuredContent([{ id: 1 }])).toEqual({
      result: [{ id: 1 }],
    });
    expect(service.toStructuredContent({ success: true })).toEqual({
      success: true,
    });
  });
});
