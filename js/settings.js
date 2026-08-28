/* ==========================================================================
   settings.js — Settings & Data Management Page Logic
   Features: Theme switcher (Light/Dark/System), Pomodoro durations configuration,
   JSON Export & Import backup, Seed reload, and complete data reset.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initThemeGroup();
  initPomodoroForm();
  bindBackupControls();
  bindDangerControls();
});

/* ==========================================================================
   Theme Preference
   ========================================================================== */
function initThemeGroup() {
  const settings = Store.getSettings();
  const currentTheme = settings.theme || 'system';

  const radio = App.qs(`input[name="themeChoice"][value="${currentTheme}"]`);
  if (radio) radio.checked = true;

  App.qsa('input[name="themeChoice"]').forEach(r => {
    r.addEventListener('change', e => {
      const val = e.target.value;
      Store.saveSettings({ theme: val });

      if (val === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', val);
      }

      App.toast(`Theme updated to ${val}`, 'success');
    });
  });
}

/* ==========================================================================
   Pomodoro Durations
   ========================================================================== */
function initPomodoroForm() {
  const settings = Store.getSettings();
  const pomo = settings.pomodoro || { focus: 25, shortBreak: 5, longBreak: 15 };

  App.qs('#pomoFocus').value = pomo.focus || 25;
  App.qs('#pomoShort').value = pomo.shortBreak || 5;
  App.qs('#pomoLong').value = pomo.longBreak || 15;

  App.qs('#pomoSettingsForm').addEventListener('submit', e => {
    e.preventDefault();

    const focus = Math.max(1, Math.min(120, parseInt(App.qs('#pomoFocus').value, 10) || 25));
    const shortBreak = Math.max(1, Math.min(30, parseInt(App.qs('#pomoShort').value, 10) || 5));
    const longBreak = Math.max(1, Math.min(60, parseInt(App.qs('#pomoLong').value, 10) || 15));

    Store.saveSettings({
      pomodoro: { focus, shortBreak, longBreak }
    });

    App.toast('Pomodoro timer settings saved!', 'success');
  });
}

/* ==========================================================================
   Backup: Export & Import JSON
   ========================================================================== */
function bindBackupControls() {
  // Export
  App.qs('#exportBtn').addEventListener('click', () => {
    const jsonStr = Store.exportJSON();
    const today = Dates.todayISO();
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `studyflow-backup-${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    App.toast('StudyFlow backup downloaded!', 'success');
  });

  // Import
  const fileInput = App.qs('#importFileInput');
  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const content = ev.target.result;
        const res = Store.importJSON(content);
        if (res.success) {
          App.toast(`Backup imported! Restored ${res.counts.tasks} tasks & ${res.counts.subjects} subjects.`, 'success');
          setTimeout(() => {
            window.location.reload();
          }, 1200);
        } else {
          App.toast(`Import failed: ${res.error}`, 'error');
        }
      } catch (err) {
        App.toast('Invalid JSON backup file format', 'error');
      }
    };
    reader.readAsText(file);
    fileInput.value = ''; // Reset input
  });
}

/* ==========================================================================
   Danger Zone: Reset All & Reload Demo
   ========================================================================== */
function bindDangerControls() {
  // Reload Demo
  App.qs('#reloadDemoBtn').addEventListener('click', () => {
    App.confirm({
      title: 'Reload starter demo data?',
      message: 'This will reset your data and seed fresh starter subjects, tasks, and notes.',
      confirmText: 'Reload Demo',
      onConfirm: () => {
        localStorage.clear();
        Store.seed();
        App.toast('Starter demo data loaded!', 'success');
        setTimeout(() => { window.location.reload(); }, 600);
      }
    });
  });

  // Reset All
  App.qs('#clearAllBtn').addEventListener('click', () => {
    App.confirm({
      title: 'Reset all StudyFlow data?',
      message: 'This will permanently remove all tasks, subjects, notes, focus history, and custom settings. This action cannot be undone.',
      confirmText: 'Yes, Delete Everything',
      onConfirm: () => {
        Store.clearAll();
        App.toast('All data has been reset.', 'info');
        setTimeout(() => { window.location.reload(); }, 600);
      }
    });
  });
}
