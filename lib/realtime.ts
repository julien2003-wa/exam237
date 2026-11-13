import * as Ably from 'ably';
import { sealForTransport } from './crypto';

/*
  Temps réel du chat (Ably).
  Le message complet voyage dans l'événement, scellé avec une clé propre au salon :
  Ably ne peut pas le lire, et les élèves le reçoivent instantanément sans recharger
  la discussion. La clé n'est donnée qu'aux membres autorisés du salon (API du chat).
*/

export function chatChannel(roomId: string) {
  return `exam237:chat:${roomId}`;
}

export function realtimeConfigured() {
  return !!process.env.ABLY_API_KEY;
}

let rest: Ably.Rest | null = null;
function client() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;
  if (!rest) rest = new Ably.Rest({ key });
  return rest;
}

export async function publishRoomEvent(
  roomId: string,
  name: string,
  data: Record<string, unknown>
) {
  const ably = client();
  if (!ably) return false;
  await ably.channels.get(chatChannel(roomId)).publish(name, data);
  return true;
}

// Publie un message complet du chat (scellé) : affichage immédiat chez les autres élèves.
export async function publishChatMessage(roomId: string, message: Record<string, unknown>) {
  return publishRoomEvent(roomId, 'message', {
    id: message.id,
    roomId,
    sealed: sealForTransport(roomId, message),
  });
}

export async function createRealtimeToken(clientId: string, capability: Record<string, string[]>) {
  const ably = client();
  if (!ably) return null;
  return ably.auth.createTokenRequest({ clientId, capability: JSON.stringify(capability) });
}
