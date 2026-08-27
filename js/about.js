/* ==========================================================================
   about.js — About page logic
   Shows a live snapshot of stored data and wires the "reset all data" action.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  renderSnapshot();

  App.qs('#resetBtn').addEventListener('click', () => {
    App.confirm({
      title: 'Reset all data?',
      message: 'This permanently deletes every subject, task and note stored in this browser. This cannot be undone.',
      confirmText: 'Yes, reset everything',
      onConfirm: () => {
        Store.clearAll();
        App.toast('All data cleared. Reloading…', 'info');
        setTimeout(() => location.reload(), 900);   // fresh seed on reload
      }
    });
  });
});

/* Live counts of the user's stored data. */
function renderSnapshot() {
  const stats = [
    { label: 'Subjects', value: Store.getSubjects().length },
    { label: 'Tasks',    value: Store.getTasks().length },
    { label: 'Notes',    value: Store.getNotes().length },
    { label: 'Completed', value: Store.getStats().completed }
  ];
  App.qs('#aboutStats').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div>
        <div class="stat-card__value">${s.value}</div>
        <div class="stat-card__label">${s.label}</div>
      </div>
    </div>`).join('');
}
