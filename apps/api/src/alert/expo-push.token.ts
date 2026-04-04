import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

export const EXPO_PUSH_CLIENT = 'EXPO_PUSH_CLIENT';

export interface IExpoPushClient {
  isValidToken(token: string): boolean;
  chunkMessages(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendChunk(chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
}
