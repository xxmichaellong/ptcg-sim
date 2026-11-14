declare const brand: unique symbol;

export type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type MatchId = Brand<string, 'MatchId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type CardDefinitionId = Brand<string, 'CardDefinitionId'>;
export type CardInstanceId = Brand<string, 'CardInstanceId'>;
export type StackId = Brand<string, 'StackId'>;
export type ZoneId = Brand<string, 'ZoneId'>;
export type WorkAreaId = Brand<string, 'WorkAreaId'>;
export type InspectionId = Brand<string, 'InspectionId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type EventBatchId = Brand<string, 'EventBatchId'>;
export type ViewCardId = Brand<string, 'ViewCardId'>;
export type ViewDefinitionId = Brand<string, 'ViewDefinitionId'>;

export const asMatchId = (value: string): MatchId => value as MatchId;
export const asPlayerId = (value: string): PlayerId => value as PlayerId;
export const asCardDefinitionId = (value: string): CardDefinitionId =>
  value as CardDefinitionId;
export const asCardInstanceId = (value: string): CardInstanceId =>
  value as CardInstanceId;
export const asStackId = (value: string): StackId => value as StackId;
export const asZoneId = (value: string): ZoneId => value as ZoneId;
export const asWorkAreaId = (value: string): WorkAreaId => value as WorkAreaId;
export const asInspectionId = (value: string): InspectionId =>
  value as InspectionId;
export const asCommandId = (value: string): CommandId => value as CommandId;
export const asEventBatchId = (value: string): EventBatchId =>
  value as EventBatchId;
export const asViewCardId = (value: string): ViewCardId => value as ViewCardId;
export const asViewDefinitionId = (value: string): ViewDefinitionId =>
  value as ViewDefinitionId;
