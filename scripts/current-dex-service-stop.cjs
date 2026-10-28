'use strict';

function install(target = process) {
  if (!target.connected) return;
  let requested = false;
  const signal = () => { if (target.listenerCount('SIGINT')) target.emit('SIGINT'); };
  const request = () => { requested = true; signal(); };
  target.on('message', message => {
    if (message?.type === 'CHAINWHISPER_SERVICE_STOP') request();
  });
  target.on('disconnect', request);
  // Admission can finish before the existing service installs its stop handler.
  target.on('newListener', event => {
    if (requested && event === 'SIGINT') queueMicrotask(signal);
  });
  target.channel?.unref();
}

module.exports = { install };
if (require.main !== module) install();
