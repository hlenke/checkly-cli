export interface Reporter {
  onBegin(sessionId: string): void;
  onEnd(sessionId: string): void;
  onCheckEnd(checkResult: any): void;
}
