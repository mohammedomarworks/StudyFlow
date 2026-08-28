/* ==========================================================================
   about.js — About page logic
   Shows a live snapshot of stored data (subjects, tasks, notes, completed, focus time).
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  renderSnapshot();
});

/* Live counts of the user's stored data */
function renderSnapshot() {
  const stats = Store.getStats();
  const study = Store.getStudyStats();

  const cards = [
    { label: 'Subjects',       value: Store.getSubjects().length, cls: '' },
    { label: 'Total Tasks',    value: stats.total,                cls: '' },
    { label: 'Completed Tasks',value: stats.completed,            cls: 'green' },
    { label: 'Notes Created',  value: Store.getNotes().length,    cls: 'blue' },
    { label: 'Focus Time',     value: Dates.formatDuration(study.totalMinutes), cls: 'orange' }
  ];

  App.qs('#aboutStats').innerHTML = cards.map((s, i) => `
    <div class="stat-card animate-in" style="--delay:${i * 50}ms">
      <div>
        <div class="stat-card__value ${s.cls}">${s.value}</div>
        <div class="stat-card__label">${s.label}</div>
      </div>
    </div>`).join('');
}

