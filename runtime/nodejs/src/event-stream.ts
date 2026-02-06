import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Streaming event log for debugging and testing
 * Records all events in JSONL format (one JSON object per line)
 * Useful for observing runtime execution, testing, and debugging
 */
export class EventStream {
  private filePath: string;
  private isEnabled: boolean = false;

  constructor(filePath?: string) {
    this.filePath = filePath || '';
    this.isEnabled = !!filePath;
  }

  /**
   * Enable event streaming to a file
   */
  async enable(filePath: string): Promise<void> {
    this.filePath = filePath;
    this.isEnabled = true;

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (dir !== '.' && dir !== '') {
      await fs.mkdir(dir, { recursive: true });
    }

    // Initialize file (truncate if exists)
    await fs.writeFile(filePath, '', 'utf-8');
  }

  /**
   * Log an event to the stream
   */
  async log(
    event: string,
    payload?: any,
    metadata?: {
      namespace?: string;
      resource?: string;
      kind?: string;
      name?: string;
    },
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      payload,
      ...metadata,
    };

    try {
      const line = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(this.filePath, line, 'utf-8');
    } catch (error) {
      console.error('Failed to write event to stream:', error);
    }
  }

  /**
   * Read all events from the stream as an array
   * Useful for testing
   */
  async readAll(): Promise<Array<Record<string, any>>> {
    if (!this.isEnabled || !this.filePath) {
      return [];
    }

    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      if (!content.trim()) {
        return [];
      }
      return content
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    } catch (error) {
      console.error('Failed to read event stream:', error);
      return [];
    }
  }

  /**
   * Filter events by type
   */
  async getEventsByType(
    eventType: string,
  ): Promise<Array<Record<string, any>>> {
    const all = await this.readAll();
    return all.filter((e) => e.event === eventType);
  }

  /**
   * Get the file path for the event stream
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Check if event streaming is enabled
   */
  isEnabledStream(): boolean {
    return this.isEnabled;
  }

  /**
   * Disable event streaming
   */
  disable(): void {
    this.isEnabled = false;
  }
}
