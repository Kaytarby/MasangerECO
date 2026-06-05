self.addEventListener('push', function(event) {
  let data = {};
  if (event.data) {
    data = event.data.json();
  }
  
  const title = data.title || "Новое сообщение";
  const options = {
    body: data.body || "Вы получили новое сообщение в Эко-культура.",
    icon: "https://api.iconify.design/mdi/leaf.svg",
    badge: "https://api.iconify.design/mdi/leaf.svg"
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
