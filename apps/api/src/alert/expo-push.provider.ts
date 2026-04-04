import { Injectable } from '@nestjs/common';
import Expo from 'expo-server-sdk';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { type IExpoPushClient } from './expo-push.token.js';

export { EXPO_PUSH_CLIENT } from './expo-push.token.js';

@Injectable()
export class ExpoPushProvider implements IExpoPushClient {
  private readonly expo = new Expo();

  isValidToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  chunkMessages(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
    return this.expo.chunkPushNotifications(messages);
  }

  async sendChunk(chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    return this.expo.sendPushNotificationsAsync(chunk);
  }
}
