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
  initAccountSection();
  initThemeGroup();
  initPomodoroForm();
  initAppPrefsForm();
  renderDiagnostics();
  bindBackupControls();
  bindDangerControls();
});

/* ==========================================================================
   0. Account & Cloud Authentication (Phase B & C)
   ========================================================================== */
function initAccountSection() {
  const badge = App.qs('#accountStatusBadge');
  const body = App.qs('#accountCardBody');
  const migrationCard = App.qs('#sectionMigration');
  const migrationBadge = App.qs('#migrationStatusBadge');
  const migrationBody = App.qs('#migrationCardBody');
  if (!badge || !body) return;

  function getRealtimeBadgeClass(status) {
    const s = status || (window.StudyFlowRealtime ? window.StudyFlowRealtime.getStatus() : 'disconnected');
    if (s === 'connected') return 'badge-success';
    if (s === 'connecting' || s === 'reconnecting') return 'badge-warning';
    if (s === 'error') return 'badge-danger';
    return 'badge-muted';
  }

  function getRealtimeBadgeText(status) {
    const s = status || (window.StudyFlowRealtime ? window.StudyFlowRealtime.getStatus() : 'disconnected');
    if (s === 'connected') return '● Realtime Sync Connected';
    if (s === 'connecting') return '○ Connecting…';
    if (s === 'reconnecting') return '○ Reconnecting…';
    if (s === 'error') return '○ Sync Error';
    if (s === 'paused') return '⏸ Sync Paused';
    return '○ Offline';
  }

  function getRealtimeLastSyncedText(lastSynced) {
    const ls = lastSynced || (window.StudyFlowRealtime ? window.StudyFlowRealtime.getLastSynced() : null);
    if (!ls) return 'Sync standby';
    return `Last synced: ${Dates.timeAgo(ls)}`;
  }

  function renderAccount(event, session, user, state) {
    const MigrationService = window.StudyFlowMigration;
    const RepoFactory = window.StudyFlowRepository ? window.StudyFlowRepository.RepositoryFactory : null;
    const Realtime = window.StudyFlowRealtime;

    if (!window.Auth) {
      badge.className = 'badge badge-muted';
      badge.textContent = 'Local Mode';
      body.innerHTML = `
        <div class="settings-row" style="padding-top:0; border-bottom:none">
          <div class="settings-row__info">
            <div class="settings-row__title">Offline Local-Only Storage</div>
            <div class="settings-row__desc">Authentication is not configured. All study data is preserved privately in your browser's localStorage.</div>
          </div>
        </div>
      `;
      if (migrationCard) migrationCard.style.display = 'none';
      return;
    }

    if (user && state === 'authenticated') {
      const isMigrated = MigrationService ? MigrationService.isCompleted(user.id) : false;
      const currentMode = RepoFactory ? RepoFactory.getMode() : 'local';

      if (isMigrated && currentMode === 'cloud') {
        badge.className = 'badge badge-success';
        badge.textContent = 'Cloud Sync Active';
      } else if (isMigrated) {
        badge.className = 'badge badge-primary';
        badge.textContent = 'Local Backup View';
      } else {
        badge.className = 'badge badge-warning';
        badge.textContent = 'Migration Ready';
      }

      const migrationStatus = MigrationService ? MigrationService.getStatus(user.id) : null;
      const formattedMigrationDate = (migrationStatus && migrationStatus.migratedAt)
        ? Dates.formatFull(migrationStatus.migratedAt.slice(0, 10))
        : '';

      body.innerHTML = `
        <div class="account-details-grid mb-4">
          <div class="account-detail-item">
            <span class="account-detail-label">Display Name</span>
            <span class="account-detail-value">${App.escapeHtml(user.displayName || 'Student')}</span>
          </div>
          <div class="account-detail-item">
            <span class="account-detail-label">Email Address</span>
            <span class="account-detail-value">${App.escapeHtml(user.email || '—')}</span>
          </div>
          <div class="account-detail-item">
            <span class="account-detail-label">User ID</span>
            <span class="account-detail-value font-mono" style="font-size:0.75rem">${App.escapeHtml((user.id || '').slice(0, 18))}…</span>
          </div>
          <div class="account-detail-item">
            <span class="account-detail-label">Active Storage</span>
            <span class="account-detail-value" style="color:${isMigrated && currentMode === 'cloud' ? 'var(--success)' : 'var(--primary)'}">
              ${isMigrated && currentMode === 'cloud' ? 'Supabase PostgreSQL (Cloud)' : (isMigrated ? 'Local Backup View' : 'Local-First (v1.5.0)')}
            </span>
          </div>
        </div>

        <div class="settings-row" style="border-bottom:none; padding-bottom:0">
          <div class="settings-row__info">
            <div class="settings-row__title">Sign Out of Cloud Account</div>
            <div class="settings-row__desc">Disconnects your cloud session. <strong>Your local planner data remains completely safe</strong> in this browser.</div>
          </div>
          <button type="button" class="btn btn-ghost" id="settingsSignOutBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            Sign Out
          </button>
        </div>
      `;

      const signOutBtn = body.querySelector('#settingsSignOutBtn');
      if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
          if (Realtime) await Realtime.destroy();
          if (RepoFactory) RepoFactory.setMode('local');
          await window.Auth.signOut();
          App.toast('Signed out successfully. Your local planner data remains intact.', 'info');
          renderDiagnostics();
        });
      }

      // Populate Migration Section
      if (migrationCard && migrationBody) {
        migrationCard.style.display = 'block';

        if (isMigrated) {
          migrationBadge.className = 'badge badge-success';
          migrationBadge.textContent = 'Cloud Active';

          migrationBody.innerHTML = `
            <div class="alert alert-success mb-4" style="font-size:var(--fs-xs);padding:var(--space-3);background:color-mix(in srgb, var(--success) 10%, var(--surface));border:1px solid var(--success);border-radius:var(--radius-sm);color:var(--text)">
              <b>✓ Cloud Connected:</b> Planner data was successfully migrated on ${formattedMigrationDate || 'recent date'}. All new changes are securely stored in your Supabase cloud account.
            </div>

            ${currentMode === 'cloud' ? `
            <div class="settings-row mb-3" id="realtimeStatusRow">
              <div class="settings-row__info">
                <div class="settings-row__title">Realtime Multi-Device Sync</div>
                <div class="settings-row__desc">Live synchronization across open clients and browser tabs.</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                <span class="badge ${getRealtimeBadgeClass()}" id="realtimeStatusBadge">${getRealtimeBadgeText()}</span>
                <small class="text-muted" id="realtimeLastSyncedText" style="font-size:var(--fs-xs)">${getRealtimeLastSyncedText()}</small>
              </div>
            </div>
            ` : ''}

            <div class="settings-row mb-3">
              <div class="settings-row__info">
                <div class="settings-row__title">Active Repository View</div>
                <div class="settings-row__desc">Switch between live Cloud storage and your preserved Local offline backup.</div>
              </div>
              <div class="btn-group" style="display:inline-flex;gap:4px">
                <button type="button" class="btn btn-sm ${currentMode === 'cloud' ? 'btn-primary' : 'btn-ghost'}" id="switchCloudModeBtn">Cloud Mode</button>
                <button type="button" class="btn btn-sm ${currentMode === 'local' ? 'btn-primary' : 'btn-ghost'}" id="switchLocalModeBtn">Local Backup</button>
              </div>
            </div>

            <div class="settings-row" style="border-bottom:none; padding-bottom:0">
              <div class="settings-row__info">
                <div class="settings-row__title">Re-upload Local Data</div>
                <div class="settings-row__desc">If you added offline items in Local Backup view, you can preview and re-sync them to the cloud without duplicates.</div>
              </div>
              <button type="button" class="btn btn-ghost" id="openPreviewModalBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Sync Updates
              </button>
            </div>
          `;

          const switchCloudBtn = migrationBody.querySelector('#switchCloudModeBtn');
          const switchLocalBtn = migrationBody.querySelector('#switchLocalModeBtn');
          if (switchCloudBtn && switchLocalBtn) {
            switchCloudBtn.addEventListener('click', () => {
              if (RepoFactory) RepoFactory.setMode('cloud', user.id);
              App.toast('Switched to Cloud Repository view.', 'success');
              renderAccount(event, session, user, state);
              renderDiagnostics();
            });
            switchLocalBtn.addEventListener('click', () => {
              if (RepoFactory) RepoFactory.setMode('local');
              App.toast('Switched to Local Backup view (read/write offline).', 'info');
              renderAccount(event, session, user, state);
              renderDiagnostics();
            });
          }
        } else {
          // Not migrated yet
          migrationBadge.className = 'badge badge-warning';
          migrationBadge.textContent = 'Migration Ready';

          const localSummary = MigrationService ? MigrationService.getLocalSummary() : { totalItems: 0, counts: {} };

          migrationBody.innerHTML = `
            <div class="alert alert-info mb-4" style="font-size:var(--fs-xs);padding:var(--space-3);background:color-mix(in srgb, var(--primary) 10%, var(--surface));border:1px solid var(--primary-soft);border-radius:var(--radius-sm);color:var(--text)">
              <b>🚀 Ready for Cloud Storage:</b> You have <b>${localSummary.totalItems}</b> local study items in this browser. You can migrate them into your Supabase account now. Your browser's local copy will stay safely preserved as an untouched backup.
            </div>

            <div class="settings-row" style="border-bottom:none; padding-bottom:0">
              <div class="settings-row__info">
                <div class="settings-row__title">Migrate Local Data to Cloud</div>
                <div class="settings-row__desc">Uploads your subjects, tasks, habits, and notes to your account. Preserves all relationships with PostgreSQL UUIDs.</div>
              </div>
              <div style="display:flex;gap:var(--space-2)">
                <button type="button" class="btn btn-ghost" id="openPreviewModalBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  Preview Migration
                </button>
                <button type="button" class="btn btn-primary" id="directMigrateBtn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Migrate Now
                </button>
              </div>
            </div>
          `;

          const directBtn = migrationBody.querySelector('#directMigrateBtn');
          if (directBtn) {
            directBtn.addEventListener('click', () => openMigrationPreview(user));
          }
        }

        const previewBtn = migrationBody.querySelector('#openPreviewModalBtn');
        if (previewBtn) {
          previewBtn.addEventListener('click', () => openMigrationPreview(user));
        }
      }
    } else {
      badge.className = 'badge badge-muted';
      badge.textContent = 'Local Mode';
      const authUrl = `auth.html?redirect=${encodeURIComponent('settings.html')}`;

      body.innerHTML = `
        <div class="settings-row" style="padding-top:0; border-bottom:none">
          <div class="settings-row__info">
            <div class="settings-row__title">Local Storage Mode</div>
            <div class="settings-row__desc">You are currently using StudyFlow offline. Sign in to link your cloud identity and migrate your study data.</div>
          </div>
          <a href="${authUrl}" class="btn btn-primary" id="settingsSignInBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
            Sign In / Create Account
          </a>
        </div>
      `;
      if (migrationCard) migrationCard.style.display = 'none';
    }
  }

  /* ---- Migration Preview & Execution Modal Controller ----------------- */
  async function openMigrationPreview(user) {
    const MigrationService = window.StudyFlowMigration;
    if (!MigrationService) {
      App.toast('Migration service is not loaded.', 'error');
      return;
    }

    const preview = await MigrationService.preview({ user });
    const modal = App.qs('#migrationPreviewModal');
    const tbody = App.qs('#migrationPreviewBody');
    const meta = App.qs('#migrationMetaInfo');
    const startBtn = App.qs('#startMigrationBtn');
    if (!modal || !tbody) return;

    if (meta) {
      meta.innerHTML = `Uploading to: <strong>${App.escapeHtml(preview.user?.email || 'Authenticated User')}</strong> (${App.escapeHtml(preview.user?.displayName || 'Student')})`;
    }

    const rows = [
      { name: 'Subjects', count: preview.counts.subjects, dest: 'public.subjects' },
      { name: 'Tasks', count: preview.counts.tasks, dest: 'public.tasks' },
      { name: 'Notes & Tags', count: preview.counts.notes, dest: 'public.notes' },
      { name: 'Habits', count: preview.counts.habits, dest: 'public.habits' },
      { name: 'Habit Completions', count: preview.counts.habitCompletions, dest: 'public.habit_completions' },
      { name: 'Focus Study Sessions', count: preview.counts.sessions, dest: 'public.study_sessions' },
      { name: 'Preferences & Settings', count: preview.counts.hasSettings ? 1 : 0, dest: 'public.settings' }
    ];

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td><span class="badge ${r.count > 0 ? 'badge-primary' : 'badge-muted'}">${r.count}</span></td>
        <td class="font-mono text-muted" style="font-size:0.75rem">${r.dest}</td>
      </tr>
    `).join('');

    App.openModal(modal);

    if (startBtn) {
      startBtn.onclick = () => {
        App.closeModal(modal);
        executeMigration(user);
      };
    }
  }

  async function executeMigration(user) {
    const MigrationService = window.StudyFlowMigration;
    const progressModal = App.qs('#migrationProgressModal');
    const progressBar = App.qs('#migrationProgressBar');
    const progressStage = App.qs('#migrationProgressStage');
    const progressDetail = App.qs('#migrationProgressDetail');
    const progressError = App.qs('#migrationProgressError');
    const progressFoot = App.qs('#migrationProgressFoot');
    const retryBtn = App.qs('#retryMigrationBtn');
    const spinner = App.qs('#migrationProgressSpinner');

    if (!progressModal) return;

    // Reset progress UI
    if (progressBar) progressBar.style.width = '5%';
    if (progressStage) progressStage.textContent = 'Initializing migration...';
    if (progressDetail) progressDetail.textContent = 'Establishing authenticated Supabase connection...';
    if (progressError) { progressError.style.display = 'none'; progressError.textContent = ''; }
    if (progressFoot) progressFoot.style.display = 'none';
    if (spinner) spinner.style.display = 'block';

    App.openModal(progressModal);

    try {
      await MigrationService.migrate({
        user,
        onProgress: (info) => {
          if (progressBar) progressBar.style.width = `${info.percent}%`;
          if (progressStage) progressStage.textContent = `Step ${info.step} of ${info.totalSteps}: ${info.message}`;
          if (progressDetail) progressDetail.textContent = `Processing ${info.entity}...`;
        }
      });

      if (progressBar) progressBar.style.width = '100%';
      if (progressStage) progressStage.textContent = 'Migration Completed Successfully!';
      if (progressDetail) progressDetail.textContent = 'All study records have been transferred. Switching to Cloud mode...';
      if (spinner) spinner.style.display = 'none';

      setTimeout(() => {
        App.closeModal(progressModal);
        App.toast('All planner data migrated to Supabase! You are now operating in Cloud mode.', 'success');
        renderAccount('MIGRATION_COMPLETE', null, user, 'authenticated');
        renderDiagnostics();
      }, 1200);

    } catch (err) {
      console.error('Migration execution failure:', err);
      if (spinner) spinner.style.display = 'none';
      if (progressStage) progressStage.textContent = 'Migration Paused';
      if (progressDetail) progressDetail.textContent = 'Your local data is 100% safe. You can retry anytime.';
      if (progressError) {
        progressError.style.display = 'block';
        progressError.textContent = err.message || 'An unexpected error occurred during migration.';
      }
      if (progressFoot) {
        progressFoot.style.display = 'flex';
      }
      if (retryBtn) {
        retryBtn.onclick = () => executeMigration(user);
      }
    }
  }

  if (window.Auth) {
    window.Auth.onAuthStateChange(renderAccount);
    window.Auth.init().then(res => {
      renderAccount('INITIAL_SESSION', res.session, res.user, res.state);
    });
  } else {
    renderAccount('NO_AUTH', null, null, 'unauthenticated');
  }

  if (window.StudyFlowRealtime && typeof window.StudyFlowRealtime.onStatusChange === 'function') {
    window.StudyFlowRealtime.onStatusChange((status, lastSynced) => {
      const statusBadge = App.qs('#realtimeStatusBadge');
      const lastSyncedText = App.qs('#realtimeLastSyncedText');
      if (statusBadge) {
        statusBadge.className = `badge ${getRealtimeBadgeClass(status)}`;
        statusBadge.textContent = getRealtimeBadgeText(status);
      }
      if (lastSyncedText) {
        lastSyncedText.textContent = getRealtimeLastSyncedText(lastSynced);
      }
    });
  }
}

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
