self.addEventListener('push', function (event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'Новое сообщение';
  const options = {
    body: data.body || 'Вы получили новое сообщение в Эко-культуре.',
    icon: '/favicon.svg',
    badge: '/favicon.svg'
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
