import * as Ably from 'ably';

export function chatChannel(roomId: string) {
  return `exam237:chat:${roomId}`;
}

export async function publishRoomEvent(roomId: string, name: string, data: Record<string, unknown>) {
  const key = process.env.ABLY_API_KEY;
  if (!key) return false;
  const client = new Ably.Rest({ key });
  await client.channels.get(chatChannel(roomId)).publish(name, data);
  return true;
}

export async function createRealtimeToken(clientId: string, capability: Record<string, string[]>) {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;
  const client = new Ably.Rest({ key });
  return client.auth.createTokenRequest({ clientId, capability: JSON.stringify(capability) });
}
