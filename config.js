/* Synthetic Data Auditor - site settings.
   backendUrl: the address of the backend API that runs the full six-attack audit (the "Full audit (server)" page),
   for example your Modal address: 'https://your-name--sda-api-web.modal.run'. Leave it empty to let visitors type it in. */
(function (g) {
  const SDA = g.SDA = g.SDA || {};
  SDA.config = Object.assign({ backendUrl: 'https://vrushti1412--sda-api-web.modal.run' }, SDA.config);
})(typeof window !== 'undefined' ? window : globalThis);
