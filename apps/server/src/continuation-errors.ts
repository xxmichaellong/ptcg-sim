export class ContinuationCollisionError extends Error {
  constructor() {
    super('Continuation locator is already initialized');
    this.name = 'ContinuationCollisionError';
  }
}

export class ContinuationCorruptError extends Error {
  constructor(message = 'Stored continuation is corrupt or unreadable') {
    super(message);
    this.name = 'ContinuationCorruptError';
  }
}
