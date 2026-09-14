/* ==========================================================================
   settings.js — Settings, Data & Personalization (Phase 7)
   Features:
   - Theme switcher (Light / Dark / System Default) with immediate preview
   - Pomodoro interval settings + Daily Focus Goal presets & dynamic labels
   - App Preferences: confirm deletes, default task sort, motion preference
   - In-memory Storage Diagnostics overview
   - Safe Backup: Export JSON with timestamp & Import with schema validation
   - Interactive Import Preview Modal with counts comparison before restore
   - Safe Danger Zone: Reload Demo Data & Reset All Data (non-reseeding)
   ========================================================================== */

let pendingImportData = null;

document.addEventListener('DOMContentLoaded', () => {
  initThemeGroup();
  initPomodoroForm();
  initAppPrefsForm();
  renderDiagnostics();
  bindBackupControls();
  bindDangerControls();
});

/* ==========================================================================
   1. Theme Preference
   ========================================================================== */
function initThemeGroup() {
  const settings = Store.getSettings();
  const currentTheme = settings.theme || 'system';

  const radio = App.qs(`input[name="themeChoice"][value="${currentTheme}"]`);
  if (radio) radio.checked = true;

  App.qsa('input[name="themeChoice"]').forEach(r => {
    r.addEventListener('change', e => {
      const val = e.target.value;
      App.setTheme(val);
      App.toast(`Theme set to ${val === 'system' ? 'System Default' : val.charAt(0).toUpperCase() + val.slice(1)}`, 'success');
    });
  });
}

/* ==========================================================================
   2. Pomodoro Durations & Daily Focus Goal
   ========================================================================== */
function initPomodoroForm() {
  const pomo = Store.getSettings().pomodoro;

  const focusInput = App.qs('#pomoFocus');
  const shortInput = App.qs('#pomoShort');
  const longInput = App.qs('#pomoLong');
  const dailyGoalInput = App.qs('#pomoDailyGoal');
  const dailyGoalHuman = App.qs('#dailyGoalHuman');
  const soundToggle = App.qs('#pomoSound');
  const autoBreakToggle = App.qs('#pomoAutoBreak');

  if (focusInput) focusInput.value = pomo.focus;
  if (shortInput) shortInput.value = pomo.shortBreak;
  if (longInput) longInput.value = pomo.longBreak;
  if (soundToggle) soundToggle.checked = pomo.sound !== false;
  if (autoBreakToggle) autoBreakToggle.checked = pomo.autoBreak === true;

  function updateGoalDisplay(val) {
    const minutes = Math.max(0, Math.min(720, parseInt(val, 10) || 0));
    if (dailyGoalHuman) {
      if (minutes === 0) {
        dailyGoalHuman.textContent = 'Daily goal disabled';
        dailyGoalHuman.style.color = 'var(--text-muted)';
      } else {
        dailyGoalHuman.textContent = `Target: ${Dates.formatDuration(minutes)}`;
        dailyGoalHuman.style.color = 'var(--primary)';
      }
    }

    // Highlight matching preset button
    App.qsa('.goal-preset-btn').forEach(btn => {
      const g = parseInt(btn.dataset.goal, 10);
      btn.classList.toggle('active', g === minutes);
    });
  }

  const initialGoal = pomo.dailyGoal != null ? pomo.dailyGoal : 120;
  if (dailyGoalInput) {
    dailyGoalInput.value = initialGoal;
    updateGoalDisplay(initialGoal);

    dailyGoalInput.addEventListener('input', e => {
      updateGoalDisplay(e.target.value);
    });
  }

  // Goal preset buttons
  App.qsa('.goal-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = parseInt(btn.dataset.goal, 10);
      if (dailyGoalInput) {
        dailyGoalInput.value = g;
        updateGoalDisplay(g);
      }
    });
  });

  App.qs('#pomoSettingsForm').addEventListener('submit', e => {
    e.preventDefault();

    const focus = Math.max(1, Math.min(120, parseInt(focusInput.value, 10) || 25));
    const shortBreak = Math.max(1, Math.min(30, parseInt(shortInput.value, 10) || 5));
    const longBreak = Math.max(1, Math.min(60, parseInt(longInput.value, 10) || 15));
    const dailyGoal = dailyGoalInput ? Math.max(0, Math.min(720, parseInt(dailyGoalInput.value, 10) || 0)) : pomo.dailyGoal;

    Store.saveSettings({
      pomodoro: {
        focus,
        shortBreak,
        longBreak,
        sound: soundToggle ? soundToggle.checked : pomo.sound,
        autoBreak: autoBreakToggle ? autoBreakToggle.checked : pomo.autoBreak,
        dailyGoal
      }
    });

    focusInput.value = focus;
    shortInput.value = shortBreak;
    longInput.value = longBreak;
    if (dailyGoalInput) {
      dailyGoalInput.value = dailyGoal;
      updateGoalDisplay(dailyGoal);
    }

    App.toast('Timer settings saved!', 'success');
  });
}

/* ==========================================================================
   3. App Preferences
   ========================================================================== */
function initAppPrefsForm() {
  const prefs = Store.getSettings().preferences;

  const confirmDeleteEl = App.qs('#prefConfirmDelete');
  const taskSortEl = App.qs('#prefTaskSort');
  const motionEl = App.qs('#prefMotion');

  if (confirmDeleteEl) confirmDeleteEl.checked = prefs.confirmDelete !== false;
  if (taskSortEl) taskSortEl.value = prefs.defaultTaskSort || 'due-asc';
  if (motionEl) motionEl.value = prefs.motion || 'system';

  // Live motion change
  if (motionEl) {
    motionEl.addEventListener('change', e => {
      App.applyMotion(e.target.value);
    });
  }

  const form = App.qs('#appPrefsForm');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();

      const confirmDelete = confirmDeleteEl ? confirmDeleteEl.checked : true;
      const defaultTaskSort = taskSortEl ? taskSortEl.value : 'due-asc';
      const motion = motionEl ? motionEl.value : 'system';

      Store.saveSettings({
        preferences: { confirmDelete, defaultTaskSort, motion }
      });

      App.applyMotion(motion);
      App.toast('App preferences saved!', 'success');
    });
  }
}

/* ==========================================================================
   4. Storage Diagnostics
   ========================================================================== */
function renderDiagnostics() {
  const diag = Store.getDiagnostics();

  const elSubj = App.qs('#diagSubjects');
  const elTasks = App.qs('#diagTasks');
  const elTasksSub = App.qs('#diagTasksSub');
  const elHabits = App.qs('#diagHabits');
  const elHabitsSub = App.qs('#diagHabitsSub');
  const elNotes = App.qs('#diagNotes');
  const elNotesSub = App.qs('#diagNotesSub');
  const elSessions = App.qs('#diagSessions');
  const elFocusHours = App.qs('#diagFocusHours');
  const elActivity = App.qs('#diagActivity');
  const elLastExport = App.qs('#lastExportDisplay');

  if (elSubj) elSubj.textContent = diag.subjectsCount;
  if (elTasks) elTasks.textContent = diag.tasksTotal;
  if (elTasksSub) elTasksSub.textContent = `${diag.tasksActive} active · ${diag.tasksCompleted} done`;
  if (elHabits) elHabits.textContent = diag.habitsTotal;
  if (elHabitsSub) elHabitsSub.textContent = `${diag.habitsActive} active · ${diag.habitsCompletedToday} done today`;
  if (elNotes) elNotes.textContent = diag.notesTotal;
  if (elNotesSub) elNotesSub.textContent = `${diag.notesPinned} pinned`;
  if (elSessions) elSessions.textContent = diag.sessionsCount;
  if (elFocusHours) elFocusHours.textContent = `${diag.focusHours}h focus total`;
  if (elActivity) elActivity.textContent = diag.activityCount;

  if (elLastExport) {
    if (diag.lastExportAt) {
      elLastExport.textContent = `${Dates.formatShort(diag.lastExportAt.slice(0, 10))} (${Dates.timeAgo(diag.lastExportAt)})`;
    } else {
      elLastExport.textContent = 'Never';
    }
  }
}

/* ==========================================================================
   5. Backup: Export & Safe Import with Preview Modal
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

    renderDiagnostics();
    App.toast('Backup exported successfully.', 'success');
  });

  // Import file selection
  const fileInput = App.qs('#importFileInput');
  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const content = ev.target.result;
        const validation = Store.validateBackup(content);

        if (!validation.valid) {
          App.toast(`Import failed: ${validation.error}`, 'error');
          fileInput.value = '';
          return;
        }

        // Show Import Preview Modal
        openImportPreview(validation);
      } catch (err) {
        App.toast('Invalid JSON backup file format', 'error');
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  });

  // Wire Modal buttons
  App.bindModalClose('#importPreviewModal');

  const confirmBtn = App.qs('#confirmRestoreBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (!pendingImportData) return;

      const res = Store.applyBackup(pendingImportData);
      App.closeModal('#importPreviewModal');
      pendingImportData = null;

      if (res.success) {
        App.toast('StudyFlow restored successfully.', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 800);
      } else {
        App.toast(`Restore failed: ${res.error}`, 'error');
      }
    });
  }

  const cancelBtn = App.qs('#cancelImportBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      pendingImportData = null;
      App.closeModal('#importPreviewModal');
    });
  }
}

function openImportPreview(validation) {
  pendingImportData = validation.normalizedData;

  const metaEl = App.qs('#importMetaInfo');
  if (metaEl) {
    let metaText = `Backup Version: <b>${App.escapeHtml(validation.version)}</b>`;
    if (validation.exportedAt) {
      metaText += ` · Created: <b>${Dates.formatFull(validation.exportedAt.slice(0, 10))} (${Dates.timeAgo(validation.exportedAt)})</b>`;
    }
    metaEl.innerHTML = metaText;
  }

  const tbody = App.qs('#importPreviewBody');
  if (tbody) {
    const rows = [
      { label: 'Subjects', curr: validation.currentCounts.subjects, inc: validation.counts.subjects },
      { label: 'Tasks', curr: validation.currentCounts.tasks, inc: validation.counts.tasks },
      { label: 'Habits', curr: validation.currentCounts.habits, inc: validation.counts.habits },
      { label: 'Notes', curr: validation.currentCounts.notes, inc: validation.counts.notes },
      { label: 'Focus Sessions', curr: validation.currentCounts.sessions, inc: validation.counts.sessions },
      { label: 'Activity Events', curr: validation.currentCounts.activity, inc: validation.counts.activity },
      { label: 'Preferences & Settings', curr: 'Included', inc: validation.counts.hasSettings ? 'Included' : 'None' }
    ];

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><b>${r.label}</b></td>
        <td>${r.curr}</td>
        <td><b style="color:var(--primary)">${r.inc}</b></td>
      </tr>
    `).join('');
  }

  App.openModal('#importPreviewModal');
}

/* ==========================================================================
   6. Danger Zone: Reset All & Reload Demo
   ========================================================================== */
function bindDangerControls() {
  // Reload Starter Demo Data
  App.qs('#reloadDemoBtn').addEventListener('click', () => {
    App.confirm({
      title: 'Load starter demo data?',
      message: 'This will replace your current planner records with starter example subjects, tasks, habits, and notes.',
      confirmText: 'Load Demo Data',
      danger: true,
      onConfirm: () => {
        Store.reseed();
        App.toast('Starter demo data loaded!', 'success');
        setTimeout(() => { window.location.reload(); }, 600);
      }
    });
  });

  // Reset All Data
  App.qs('#clearAllBtn').addEventListener('click', () => {
    App.confirm({
      title: 'Reset all StudyFlow data?',
      message: 'This will permanently remove your tasks, habits, subjects, notes, sessions, activity history, and settings from this browser. The app will open clean and empty without automatic reseeding.',
      confirmText: 'Yes, Delete Everything',
      danger: true,
      onConfirm: () => {
        Store.clearAll();
        App.toast('All data has been reset.', 'info');
        setTimeout(() => { window.location.reload(); }, 600);
      }
    });
  });
}
