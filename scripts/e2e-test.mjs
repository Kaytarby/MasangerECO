/* End-to-end test for the messenger API + Socket.IO */
import { io } from 'socket.io-client';
import fs from 'fs';

const BASE = 'http://127.0.0.1:3000';
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const rnd = Date.now() % 100000;
const phoneA = `79001111${rnd}`;
const phoneB = `79002222${rnd}`;

// 1. Register
const regA = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: phoneA, password: 'pass1234', name: 'Анна Садовод' })
}).then(r => r.json());
check('register A', !!regA.token && regA.user?.name === 'Анна Садовод');

const regB = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: phoneB, password: 'pass1234', name: 'Борис Флорист' })
}).then(r => r.json());
check('register B', !!regB.token);

// duplicate phone (normalized) should fail
const dup = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '+7 900 111-' + phoneA.slice(-6), password: 'x', name: 'Dup' })
}).then(async (r) => ({ status: r.status, body: await r.json() }));
check('duplicate phone rejected', dup.status === 400, JSON.stringify(dup.body));

// 2. Login
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: phoneA, password: 'pass1234' })
}).then(r => r.json());
check('login A', !!login.token);
const badLogin = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: phoneA, password: 'wrong' })
}).then(r => r.status);
check('wrong password rejected', badLogin === 400);

const H = (t) => ({ 'Authorization': `Bearer ${t}` });

// 3. Users list
const users = await fetch(`${BASE}/api/users`, { headers: H(regA.token) }).then(r => r.json());
check('users list for A contains B', users.users?.some(u => u.id === regB.user.id));

// 4. Create direct chat
const chat = await fetch(`${BASE}/api/chats`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...H(regA.token) },
  body: JSON.stringify({ type: 'direct', participantIds: [regB.user.id] })
}).then(r => r.json());
check('create direct chat', !!chat.chatId);
const chat2 = await fetch(`${BASE}/api/chats`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...H(regB.token) },
  body: JSON.stringify({ type: 'direct', participantIds: [regA.user.id] })
}).then(r => r.json());
check('direct chat is reused', chat2.chatId === chat.chatId);

// 5. Socket connections for both users
const sockA = io(BASE, { auth: { token: regA.token }, transports: ['websocket'] });
const sockB = io(BASE, { auth: { token: regB.token }, transports: ['websocket'] });
const connected = await Promise.all([
  new Promise(res => sockA.on('connect', () => res(true))),
  new Promise(res => sockB.on('connect', () => res(true)))
]);
check('sockets connected', connected.every(Boolean));

const gotMsg = new Promise(res => {
  sockB.on('new_message', (m) => res(m));
});
sockB.emit('join_chat', chat.chatId);

// 6. Send text message A -> B
const send = await fetch(`${BASE}/api/chats/${chat.chatId}/messages`, {
  method: 'POST', headers: H(regA.token),
  body: (() => { const f = new FormData(); f.append('text', 'Привет! Как растут твои томаты?'); return f; })()
}).then(r => r.json());
check('send text message', !!send.message?.id && send.message.text.includes('томаты') && send.message.sender_name === 'Анна Садовод');

const received = await Promise.race([gotMsg, new Promise(r => setTimeout(() => r(null), 5000))]);
check('B receives message in realtime', received?.id === send.message.id);

// Unread for B right after A's message (B has not replied/opened the chat yet)
const chatsBPre = await fetch(`${BASE}/api/chats`, { headers: H(regB.token) }).then(r => r.json());
check('B sees unread=1 before replying', chatsBPre.chats?.find(c => c.id === chat.chatId)?.unread === 1,
  JSON.stringify({ unread: chatsBPre.chats?.find(c => c.id === chat.chatId)?.unread }));

// 7. Image message (1x1 PNG)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const imgForm = new FormData();
imgForm.append('text', 'Вот фото');
imgForm.append('image', new Blob([png], { type: 'image/png' }), 'photo.png');
const imgRes = await fetch(`${BASE}/api/chats/${chat.chatId}/messages`, {
  method: 'POST', headers: H(regB.token), body: imgForm
});
const imgMsg = await imgRes.json();
check('send image message', imgRes.status === 200 && !!imgMsg.message?.image_url, imgMsg.message?.image_url);
const imgFile = await fetch(BASE + imgMsg.message.image_url);
check('image is served', imgFile.status === 200);

// non-image file must be rejected
const badForm = new FormData();
badForm.append('text', 'x');
badForm.append('image', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'a.txt');
const badUpload = await fetch(`${BASE}/api/chats/${chat.chatId}/messages`, { method: 'POST', headers: H(regB.token), body: badForm }).then(r => r.status);
check('non-image upload rejected', badUpload === 400);

// 8. Messages history for B
const hist = await fetch(`${BASE}/api/chats/${chat.chatId}/messages`, { headers: H(regB.token) }).then(r => r.json());
check('history has 2 messages', hist.messages?.length === 2);

// 9. Chat list: B's unread cleared after B replied (replying means user is in the chat)
const chatsB = await fetch(`${BASE}/api/chats`, { headers: H(regB.token) }).then(r => r.json());
const bChat = chatsB.chats?.find(c => c.id === chat.chatId);
check('B unread=0 after replying', bChat?.unread === 0, JSON.stringify({ unread: bChat?.unread }));
check('last message is image with caption', bChat?.last_message_image != null && bChat?.last_message === 'Вот фото');

// 10. A now has 1 unread (B's image); explicit mark-read clears it
const chatsAPre = await fetch(`${BASE}/api/chats`, { headers: H(regA.token) }).then(r => r.json());
check('A sees unread=1', chatsAPre.chats?.find(c => c.id === chat.chatId)?.unread === 1);
const readRes = await fetch(`${BASE}/api/chats/${chat.chatId}/read`, { method: 'POST', headers: H(regA.token) }).then(r => r.json());
check('mark chat read', readRes.ok === true);
const chatsA2 = await fetch(`${BASE}/api/chats`, { headers: H(regA.token) }).then(r => r.json());
check('A unread now 0', chatsA2.chats?.find(c => c.id === chat.chatId)?.unread === 0);

// 11. Group chat
const group = await fetch(`${BASE}/api/chats`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...H(regA.token) },
  body: JSON.stringify({ type: 'group', name: 'Клуб садоводов', participantIds: [regB.user.id] })
}).then(r => r.json());
check('create group chat', !!group.chatId);
const gmsg = await fetch(`${BASE}/api/chats/${group.chatId}/messages`, {
  method: 'POST', headers: H(regA.token),
  body: (() => { const f = new FormData(); f.append('text', 'Добро пожаловать!'); return f; })()
}).then(r => r.json());
check('group message sent', gmsg.message?.sender_name === 'Анна Садовод');

// 12. Profile update with avatar
const pForm = new FormData();
pForm.append('name', 'Анна Садовод-Старшая');
pForm.append('bio', 'Люблю розы');
pForm.append('avatar', new Blob([png], { type: 'image/png' }), 'me.png');
const prof = await fetch(`${BASE}/api/users/profile`, { method: 'PUT', headers: H(regA.token), body: pForm }).then(r => r.json());
check('profile updated with avatar', prof.user?.name === 'Анна Садовод-Старшая' && !!prof.user.avatar);

// 13. Access control: stranger cannot read messages
const regC = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: `79003333${rnd}`, password: 'pass1234', name: 'Виктория' })
}).then(r => r.json());
const forbidden = await fetch(`${BASE}/api/chats/${chat.chatId}/messages`, { headers: H(regC.token) }).then(r => r.status);
check('stranger blocked from chat', forbidden === 403);

sockA.close(); sockB.close();
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TESTS FAILED`);
process.exit(failures === 0 ? 0 : 1);
