// Visibility-aware polling — shared by client.html and company.html.
const Polling = (() => {
  const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

  function create(tasks, intervalMs = DEFAULT_INTERVAL_MS) {
    let timers = [];

    function runAll() {
      tasks.forEach((fn) => fn());
    }

    function start() {
      stop();
      timers = tasks.map((fn) => setInterval(fn, intervalMs));
    }

    function stop() {
      timers.forEach(clearInterval);
      timers = [];
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stop();
      } else {
        runAll();
        start();
      }
    });

    if (!document.hidden) start();
    return { start, stop, runAll };
  }

  return { create, DEFAULT_INTERVAL_MS };
})();
