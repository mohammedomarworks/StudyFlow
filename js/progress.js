/* ==========================================================================
   progress.js — Academic Progress & Analytics Logic
   Features:
     - Range filtering: Today, This Week (default), Last 7 Days, This Month,
       Last 30 Days, All Time
     - Top summary metrics: Focus Time, Task Completion, Study Consistency,
       Daily Focus Goal
     - Study Time Trend: Pure HTML/CSS/SVG daily bar chart with tooltips
     - Study Consistency & Weekly Pattern: Active days, current & longest streak,
       day-of-week distribution
     - Subject Study Distribution: Proportional horizontal bars with subject colors
     - Task Workload vs. Focus: Estimated task workload vs. recorded focus time
     - Academic Progress by Subject & Priority breakdown
     - Data-driven factual productivity insights
     - Chronological activity timeline
   ========================================================================== */

let currentRange = 'week';

document.addEventListener('DOMContentLoaded', () => {
  bindRangeSelector();
  renderAllAnalytics(currentRange);
});

/* ==========================================================================
   Date Range Calculation (Local Timezone Safe)
   ========================================================================== */
function getDateRangeBounds(rangeKey) {
  const today = Dates.todayISO();
  const todayDate = Dates.parse(today);

  switch (rangeKey) {
    case 'today':
      return { start: today, end: today, days: [today], label: 'Today' };

    case 'week': {
      // Sun through Sat of current week
      const dayOfWeek = todayDate.getDay(); // 0=Sun
      const startDate = new Date(todayDate);
      startDate.setDate(todayDate.getDate() - dayOfWeek);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        days.push(Dates.toISO(d));
      }
      return { start: days[0], end: days[6], days, label: 'This Week' };
    }

    case 'last7': {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayDate);
        d.setDate(todayDate.getDate() - i);
        days.push(Dates.toISO(d));
      }
      return { start: days[0], end: days[6], days, label: 'Last 7 Days' };
    }

    case 'month': {
      const year = todayDate.getFullYear();
      const month = todayDate.getMonth();
      const lastDayNum = new Date(year, month + 1, 0).getDate();
      const days = [];
      for (let i = 1; i <= lastDayNum; i++) {
        days.push(Dates.toISO(new Date(year, month, i)));
      }
      return { start: days[0], end: days[days.length - 1], days, label: 'This Month' };
    }

    case 'last30': {
      const days = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(todayDate);
        d.setDate(todayDate.getDate() - i);
        days.push(Dates.toISO(d));
      }
      return { start: days[0], end: days[29], days, label: 'Last 30 Days' };
    }

    case 'all':
    default: {
      return { start: null, end: null, days: null, label: 'All Time' };
    }
  }
}

/* Bind range selector buttons */
function bindRangeSelector() {
  const container = App.qs('#analyticsRangeBar');
  if (!container) return;

  App.qsa('.range-btn', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      if (range === currentRange) return;

      currentRange = range;
      App.qsa('.range-btn', container).forEach(b => b.classList.toggle('active', b === btn));
      renderAllAnalytics(currentRange);
    });
  });
}

/* ==========================================================================
   Master Render Pipeline (Single Memory Snapshot)
   ========================================================================== */
function renderAllAnalytics(rangeKey) {
  const bounds = getDateRangeBounds(rangeKey);

  // Single snapshot of all datasets
  const allTasks = Store.getTasks();
  const allSubjects = Store.getSubjects();
  const allSessions = Store.getSessions().filter(s => s.type === 'focus');
  const settings = Store.getSettings();
  const studyStats = Store.getStudyStats();

  // Filter sessions in range
  const rangeSessions = allSessions.filter(s => {
    const sDate = Dates.localDateFromDateTime(s.completedAt);
    if (!sDate) return false;
    if (bounds.days) return bounds.days.includes(sDate);
    if (bounds.start && bounds.end) return sDate >= bounds.start && sDate <= bounds.end;
    return true;
  });

  // Filter tasks in range (due date in range or completed in range)
  const rangeTasks = allTasks.filter(t => {
    if (bounds.days) {
      return bounds.days.includes(t.dueDate) || (t.completedAt && bounds.days.includes(Dates.localDateFromDateTime(t.completedAt)));
    }
    if (bounds.start && bounds.end) {
      const dueInRange = t.dueDate && t.dueDate >= bounds.start && t.dueDate <= bounds.end;
      const compDate = t.completedAt ? Dates.localDateFromDateTime(t.completedAt) : '';
      const compInRange = compDate && compDate >= bounds.start && compDate <= bounds.end;
      return dueInRange || compInRange;
    }
    return true; // all time
  });

  const snapshot = {
    allTasks,
    allSubjects,
    allSessions,
    rangeSessions,
    rangeTasks,
    settings,
    studyStats
  };

  // Render components
  renderTopSummaryMetrics(snapshot, bounds);
  renderStudyTrendChart(snapshot, bounds);
  renderConsistencyAndPattern(snapshot, bounds);
  renderSubjectStudyDistribution(snapshot, bounds);
  renderWorkloadVsFocus(snapshot, bounds);
  renderSubjectAcademicProgress(snapshot);
  renderPriorityBreakdown(snapshot);
  renderProductivityInsights(snapshot, bounds);
  renderActivityTimeline();
}

/* ==========================================================================
   1. Top Summary Metrics Grid
   ========================================================================== */
function renderTopSummaryMetrics(snapshot, bounds) {
  const { rangeSessions, rangeTasks, settings, studyStats } = snapshot;

  // 1. Focus Time in Period
  const totalFocusMins = rangeSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
  const sessionCount = rangeSessions.length;
  App.qs('#summaryFocusVal').textContent = Dates.formatDuration(totalFocusMins);
  App.qs('#summaryFocusSub').textContent = `${sessionCount} focus session${sessionCount === 1 ? '' : 's'} in ${bounds.label.toLowerCase()}`;

  // 2. Task Completion
  const completedTasks = rangeTasks.filter(t => t.completed).length;
  const totalTasks = rangeTasks.length;
  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  App.qs('#summaryTasksVal').textContent = `${completionRate}%`;
  App.qs('#summaryTasksSub').textContent = totalTasks
    ? `${completedTasks} of ${totalTasks} tasks completed`
    : 'No tasks scheduled in period';

  // 3. Study Consistency (Streak)
  const streak = studyStats.streakDays || 0;
  const longest = studyStats.longestStreak || streak;
  App.qs('#summaryStreakVal').textContent = `${streak} ${streak === 1 ? 'day' : 'days'}`;
  App.qs('#summaryStreakSub').textContent = `Best streak: ${longest}d · ${studyStats.totalSessions} total sessions`;

  // 4. Daily Focus Goal Progress
  const pomo = settings.pomodoro || {};
  const dailyGoal = pomo.dailyGoal != null ? pomo.dailyGoal : 120;
  const todayMins = studyStats.todayMinutes || 0;

  if (dailyGoal > 0) {
    const goalPct = Math.min(100, Math.round((todayMins / dailyGoal) * 100));
    App.qs('#summaryGoalVal').textContent = `${Dates.formatDuration(todayMins)} / ${Dates.formatDuration(dailyGoal)}`;
    if (todayMins >= dailyGoal) {
      const over = todayMins - dailyGoal;
      App.qs('#summaryGoalSub').innerHTML = `<b class="text-success">🎉 Goal achieved!</b>${over > 0 ? ` (+${Dates.formatDuration(over)})` : ''}`;
    } else {
      const left = dailyGoal - todayMins;
      App.qs('#summaryGoalSub').textContent = `${goalPct}% today · ${Dates.formatDuration(left)} remaining`;
    }
  } else {
    App.qs('#summaryGoalVal').textContent = Dates.formatDuration(todayMins);
    App.qs('#summaryGoalSub').textContent = 'Daily goal disabled in Settings';
  }
}

/* ==========================================================================
   2. Study Time Trend Chart (Pure HTML/CSS/SVG)
   ========================================================================== */
function renderStudyTrendChart(snapshot, bounds) {
  const { rangeSessions } = snapshot;
  const chartBox = App.qs('#studyTrendChart');
  const badge = App.qs('#trendRangeBadge');
  const sub = App.qs('#trendSubtitle');

  if (badge) badge.textContent = bounds.label;
  if (sub) sub.textContent = `Daily focus minutes for ${bounds.label}`;

  // If All Time: gather active calendar days from first session to today
  let days = bounds.days;
  if (!days) {
    if (!rangeSessions.length) {
      days = [];
    } else {
      const allDates = rangeSessions.map(s => Dates.localDateFromDateTime(s.completedAt)).filter(Boolean).sort();
      const firstDate = Dates.parse(allDates[0]) || Dates.parse(Dates.todayISO());
      const todayDate = Dates.parse(Dates.todayISO());
      days = [];
      const cur = new Date(firstDate);
      while (cur <= todayDate) {
        days.push(Dates.toISO(cur));
        cur.setDate(cur.getDate() + 1);
      }
      // If range is extremely large (> 60 days), keep recent 30 days for readability
      if (days.length > 30) days = days.slice(-30);
    }
  }

  // Aggregate minutes by day
  const dayMinutes = {};
  rangeSessions.forEach(s => {
    const d = Dates.localDateFromDateTime(s.completedAt);
    if (d) dayMinutes[d] = (dayMinutes[d] || 0) + (s.durationMinutes || 0);
  });

  const totalMin = rangeSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

  if (!days.length || totalMin === 0) {
    chartBox.innerHTML = `
      <div class="empty" style="padding:var(--space-6) 0">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <h3>No study sessions in this period</h3>
        <p>Start a session in the <a href="timer.html" class="text-primary font-bold">Focus Timer</a> to see your daily trend.</p>
      </div>`;
    App.qs('#studyTrendSummary').textContent = 'No focus sessions recorded for this time range.';
    return;
  }

  const maxMin = Math.max(30, ...Object.values(dayMinutes));
  const today = Dates.todayISO();

  // Helper to format concise day labels
  const formatDayLabel = (dStr) => {
    const d = Dates.parse(dStr);
    if (!d) return '';
    if (bounds.days && bounds.days.length <= 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  chartBox.innerHTML = `
    <div class="trend-chart-container" role="region" aria-label="Daily study time bar chart">
      <div class="trend-chart-bars">
        ${days.map(dStr => {
          const mins = dayMinutes[dStr] || 0;
          const pct = maxMin > 0 ? Math.round((mins / maxMin) * 100) : 0;
          const dayLbl = formatDayLabel(dStr);
          const isToday = dStr === today;
          const fullDateStr = Dates.formatShort(dStr);

          return `
            <div class="chart-col ${isToday ? 'is-today' : ''} ${mins > 0 ? 'has-study' : ''}"
                 tabindex="0"
                 aria-label="${fullDateStr}: ${Dates.formatDuration(mins)} focus">
              <div class="chart-val">${mins > 0 ? Dates.formatDuration(mins) : ''}</div>
              <div class="chart-bar-track">
                <div class="chart-bar-fill" data-height="${pct}%" style="height:0%"></div>
              </div>
              <div class="chart-lbl" title="${fullDateStr}">${dayLbl}</div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  // Animate bar heights smoothly
  requestAnimationFrame(() => {
    App.qsa('#studyTrendChart .chart-bar-fill').forEach(bar => {
      bar.style.height = bar.dataset.height;
    });
  });

  // Accessible summary for screen readers
  const summaryText = days
    .map(d => `${Dates.formatShort(d)}: ${Dates.formatDuration(dayMinutes[d] || 0)}`)
    .join(', ');
  App.qs('#studyTrendSummary').textContent = `Study time trend for ${bounds.label}: ${summaryText}`;
}

/* ==========================================================================
   3. Study Consistency & Weekly Pattern (Day-of-Week Habits)
   ========================================================================== */
function renderConsistencyAndPattern(snapshot, bounds) {
  const { rangeSessions, studyStats } = snapshot;

  // Active study days in selected period
  const uniqueStudyDays = new Set(
    rangeSessions
      .map(s => Dates.localDateFromDateTime(s.completedAt))
      .filter(Boolean)
  );
  const activeCount = uniqueStudyDays.size;
  const totalDays = bounds.days ? bounds.days.length : uniqueStudyDays.size;

  const badge = App.qs('#activeDaysBadge');
  if (badge) {
    badge.textContent = bounds.days
      ? `${activeCount} of ${totalDays} active days`
      : `${activeCount} active study days`;
  }

  // Day of Week Distribution (Sun=0 to Sat=6) across range sessions
  const dowMinutes = [0, 0, 0, 0, 0, 0, 0];
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowFullNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  rangeSessions.forEach(s => {
    const d = Dates.parse(Dates.localDateFromDateTime(s.completedAt));
    if (d) {
      dowMinutes[d.getDay()] += (s.durationMinutes || 0);
    }
  });

  const maxDowMin = Math.max(1, ...dowMinutes);
  let peakDow = -1;
  let peakDowMin = 0;
  dowMinutes.forEach((m, idx) => {
    if (m > peakDowMin) {
      peakDowMin = m;
      peakDow = idx;
    }
  });

  const dowContainer = App.qs('#dowDistribution');
  if (dowContainer) {
    dowContainer.innerHTML = dowNames.map((name, i) => {
      const mins = dowMinutes[i];
      const pct = Math.round((mins / maxDowMin) * 100);
      const isPeak = i === peakDow && mins > 0;
      return `
        <div class="dow-col ${isPeak ? 'is-peak' : ''}" title="${dowFullNames[i]}: ${Dates.formatDuration(mins)}">
          <div class="dow-val">${mins > 0 ? Dates.formatDuration(mins) : '0m'}</div>
          <div class="dow-track">
            <div class="dow-fill" data-height="${pct}%" style="height:0%"></div>
          </div>
          <div class="dow-label">${name}</div>
        </div>`;
    }).join('');

    requestAnimationFrame(() => {
      App.qsa('#dowDistribution .dow-fill').forEach(fill => {
        fill.style.height = fill.dataset.height;
      });
    });
  }

  // Consistency & pattern highlight box
  const highlightBox = App.qs('#patternHighlightBox');
  if (highlightBox) {
    const streak = studyStats.streakDays || 0;
    const longest = studyStats.longestStreak || streak;

    let peakText = 'Log more sessions across the week to discover your peak focus day.';
    if (peakDow >= 0 && peakDowMin > 0) {
      peakText = `<b>${dowFullNames[peakDow]}</b> is your most active study day (${Dates.formatDuration(peakDowMin)} recorded).`;
    }

    highlightBox.innerHTML = `
      <div class="flex-between align-center mb-2">
        <span class="flex-center gap-2 font-medium" style="font-size:var(--fs-sm)">
          <span>🔥</span> Current: <b>${streak}d</b> · Best: <b>${longest}d</b>
        </span>
        <a href="timer.html" class="btn btn-ghost btn-sm">Study Now</a>
      </div>
      <p class="text-muted" style="font-size:var(--fs-xs); margin:0; line-height:1.4">
        ${peakText} Study days count only actual focused Pomodoro sessions.
      </p>`;
  }
}

/* ==========================================================================
   4. Subject Study Time Distribution
   ========================================================================== */
function renderSubjectStudyDistribution(snapshot) {
  const { allSubjects, rangeSessions } = snapshot;
  const container = App.qs('#subjectDistribution');
  const countBadge = App.qs('#subjectDistCountBadge');
  if (!container) return;

  const totalMin = rangeSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

  // Group minutes and sessions by subject
  const subjStats = {};
  rangeSessions.forEach(s => {
    const sid = s.subjectId || 'general';
    if (!subjStats[sid]) subjStats[sid] = { minutes: 0, sessions: 0 };
    subjStats[sid].minutes += (s.durationMinutes || 0);
    subjStats[sid].sessions += 1;
  });

  const entries = Object.entries(subjStats)
    .map(([sid, data]) => {
      const subject = sid === 'general' ? null : allSubjects.find(x => x.id === sid);
      return {
        id: sid,
        name: subject ? subject.name : 'General Study',
        color: subject ? subject.color : '#64748b',
        minutes: data.minutes,
        sessions: data.sessions,
        percent: totalMin > 0 ? Math.round((data.minutes / totalMin) * 100) : 0
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  if (countBadge) {
    countBadge.textContent = `${entries.length} ${entries.length === 1 ? 'subject' : 'subjects'}`;
  }

  if (!entries.length || totalMin === 0) {
    container.innerHTML = `
      <div class="empty" style="padding:var(--space-4) 0">
        <p class="text-muted">No focus sessions linked to subjects in this period.</p>
        <a href="timer.html" class="btn btn-ghost btn-sm mt-2">Start Focus Session</a>
      </div>`;
    return;
  }

  container.innerHTML = entries.map(e => `
    <div class="subject-dist-row mb-3">
      <div class="flex-between align-center mb-1">
        <a href="${e.id !== 'general' ? `subjects.html` : 'timer.html'}" class="subject-dist-name flex-center gap-2" title="View details">
          <span class="dot" style="background:${e.color}"></span>
          <b>${App.escapeHtml(e.name)}</b>
        </a>
        <div class="subject-dist-stats" style="font-size:var(--fs-sm)">
          <b>${Dates.formatDuration(e.minutes)}</b>
          <span class="text-muted font-normal">(${e.percent}%)</span>
        </div>
      </div>
      <div class="timer-progress-track" style="height:8px">
        <div class="timer-progress-fill" style="width:${e.percent}%; background:${e.color}"></div>
      </div>
      <div class="flex-between mt-1 text-muted" style="font-size:var(--fs-xs)">
        <span>${e.sessions} ${e.sessions === 1 ? 'session' : 'sessions'}</span>
        <span>${e.percent}% of focus time</span>
      </div>
    </div>`).join('');
}

/* ==========================================================================
   5. Task Workload vs. Focus Analysis
   ========================================================================== */
function renderWorkloadVsFocus(snapshot) {
  const { rangeTasks, rangeSessions } = snapshot;
  const container = App.qs('#workloadFocusContent');
  if (!container) return;

  const totalEstMinutes = rangeTasks.reduce((acc, t) => acc + (t.estimate || 0), 0);
  const totalFocusMinutes = rangeSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

  const doneTasks = rangeTasks.filter(t => t.completed).length;
  const today = Dates.todayISO();
  const overdueTasks = rangeTasks.filter(t => !t.completed && t.dueDate && t.dueDate < today).length;
  const pendingTasks = rangeTasks.length - doneTasks;
  const totalTasks = rangeTasks.length;

  const donePct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const overduePct = totalTasks ? Math.round((overdueTasks / totalTasks) * 100) : 0;
  const activePct = totalTasks ? Math.max(0, 100 - donePct - overduePct) : 0;

  container.innerHTML = `
    <!-- Top comparative metrics -->
    <div class="grid two-col gap-3 mb-4">
      <div class="timer-stat-col">
        <div class="timer-stat-val">${Dates.formatDuration(totalEstMinutes)}</div>
        <div class="timer-stat-lbl">Planned Task Estimates</div>
      </div>
      <div class="timer-stat-col">
        <div class="timer-stat-val text-primary">${Dates.formatDuration(totalFocusMinutes)}</div>
        <div class="timer-stat-lbl">Actual Recorded Focus</div>
      </div>
    </div>

    <!-- Multi-segment completion ratio bar -->
    <div class="mb-3">
      <div class="flex-between mb-1" style="font-size:var(--fs-xs)">
        <span class="font-medium">Task Status Distribution (${totalTasks} tasks)</span>
        <span><b>${doneTasks}</b> done · <b>${overdueTasks}</b> overdue</span>
      </div>
      <div class="segmented-progress-track">
        <div class="segmented-fill bg-success" style="width:${donePct}%" title="${doneTasks} completed (${donePct}%)"></div>
        <div class="segmented-fill bg-primary" style="width:${activePct}%" title="${pendingTasks - overdueTasks} active (${activePct}%)"></div>
        <div class="segmented-fill bg-danger" style="width:${overduePct}%" title="${overdueTasks} overdue (${overduePct}%)"></div>
      </div>
      <div class="flex wrap gap-3 mt-2 text-muted" style="font-size:var(--fs-xs)">
        <span class="flex-center gap-1"><span class="dot" style="background:var(--success)"></span> Done (${donePct}%)</span>
        <span class="flex-center gap-1"><span class="dot" style="background:var(--primary)"></span> Active (${activePct}%)</span>
        ${overdueTasks > 0 ? `<a href="tasks.html?status=overdue" class="flex-center gap-1 text-danger font-bold"><span class="dot" style="background:var(--danger)"></span> Overdue (${overduePct}%)</a>` : ''}
      </div>
    </div>

    <p class="text-muted mt-3 mb-0" style="font-size:var(--fs-xs); line-height:1.4">
      💡 <b>Note:</b> Focus time is recorded independently from task estimates and helps you calibrate future time planning.
    </p>`;
}

/* ==========================================================================
   6. Subject Academic Progress
   ========================================================================== */
function renderSubjectAcademicProgress() {
  const subjects = Store.getSubjectProgress();
  const box = App.qs('#subjectProgress');
  if (!box) return;

  if (!subjects.length) {
    box.innerHTML = `<p class="text-muted text-center" style="padding:var(--space-5) 0">No subjects created yet.</p>`;
    return;
  }

  const today = Dates.todayISO();

  box.innerHTML = subjects.map(s => {
    let examBadge = '';
    if (s.examDate) {
      const rel = Dates.relative(s.examDate);
      const isPast = s.examDate < today;
      examBadge = `<span class="badge ${isPast ? 'badge-muted' : 'badge-danger'}" style="font-size:0.7rem">📚 Exam ${rel}</span>`;
    }

    return `
      <div class="progress-row" style="margin-bottom:var(--space-4)">
        <div class="progress-row__top flex-between align-center">
          <a href="subjects.html" class="flex-center gap-2" title="Manage ${App.escapeHtml(s.name)}">
            <span class="dot" style="background:${s.color}"></span>
            <b>${App.escapeHtml(s.name)}</b>
          </a>
          <div class="flex-center gap-2">
            ${examBadge}
            <span class="text-muted" style="font-size:var(--fs-xs)">${s.doneTasks}/${s.totalTasks} done (${s.percent}%)</span>
          </div>
        </div>
        <div class="bar">
          <div class="bar__fill" data-pct="${s.percent}" style="width:0; background:${s.color}"></div>
        </div>
        <div class="flex wrap gap-2 mt-1" style="font-size:var(--fs-xs); color:var(--text-muted)">
          <span>📝 ${s.notesCount} note${s.notesCount === 1 ? '' : 's'}</span>
          ${s.focusMinutes > 0 ? `<span>· ⏱️ ${Dates.formatDuration(s.focusMinutes)} total study</span>` : ''}
          ${s.overdueTasks > 0 ? `<a href="tasks.html?status=overdue" class="text-danger font-bold">· ⚠️ ${s.overdueTasks} overdue</a>` : ''}
        </div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    App.qsa('#subjectProgress .bar__fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  });
}

/* ==========================================================================
   7. Tasks by Priority Breakdown
   ========================================================================== */
function renderPriorityBreakdown(snapshot) {
  const { allTasks } = snapshot;
  const box = App.qs('#priorityBreakdown');
  if (!box) return;

  if (!allTasks.length) {
    box.innerHTML = `<p class="text-muted text-center" style="padding:var(--space-5) 0">No tasks to analyze yet.</p>`;
    return;
  }

  const levels = [
    { key: 'high',   label: 'High priority',   color: 'var(--danger)', filter: 'high' },
    { key: 'medium', label: 'Medium priority', color: 'var(--warning)', filter: 'medium' },
    { key: 'low',    label: 'Low priority',    color: 'var(--success)', filter: 'low' }
  ];

  box.innerHTML = levels.map(l => {
    const all = allTasks.filter(t => t.priority === l.key);
    const done = all.filter(t => t.completed).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    return `
      <div class="progress-row" style="margin-bottom:var(--space-4)">
        <div class="progress-row__top flex-between">
          <a href="tasks.html?priority=${l.filter}" class="flex-center gap-2" title="Filter ${l.label} in Tasks">
            <span class="dot" style="background:${l.color}"></span>
            <span>${l.label}</span>
          </a>
          <b>${done}/${all.length} done (${pct}%)</b>
        </div>
        <div class="bar">
          <div class="bar__fill" data-pct="${pct}" style="width:0; background:${l.color}"></div>
        </div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    App.qsa('#priorityBreakdown .bar__fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  });
}

/* ==========================================================================
   8. Data-Driven Productivity Insights
   ========================================================================== */
function renderProductivityInsights(snapshot, bounds) {
  const { allSubjects, rangeSessions, rangeTasks, studyStats } = snapshot;
  const box = App.qs('#productivityInsightsList');
  if (!box) return;

  const insights = [];

  // 1. Top Focus Subject
  const subjMinutes = {};
  rangeSessions.forEach(s => {
    if (s.subjectId) subjMinutes[s.subjectId] = (subjMinutes[s.subjectId] || 0) + (s.durationMinutes || 0);
  });
  let topSubjId = null, topSubjMin = 0;
  for (const [sid, mins] of Object.entries(subjMinutes)) {
    if (mins > topSubjMin) { topSubjMin = mins; topSubjId = sid; }
  }
  const totalRangeMin = rangeSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

  if (topSubjId && topSubjMin > 0) {
    const subj = allSubjects.find(s => s.id === topSubjId);
    if (subj) {
      const pct = totalRangeMin > 0 ? Math.round((topSubjMin / totalRangeMin) * 100) : 0;
      insights.push({
        icon: '🎯',
        title: 'Primary Study Focus',
        desc: `Most of your focus in ${bounds.label.toLowerCase()} was dedicated to <b>${App.escapeHtml(subj.name)}</b> (${Dates.formatDuration(topSubjMin)}, ${pct}% of total focus).`
      });
    }
  }

  // 2. Task Momentum
  const doneCount = rangeTasks.filter(t => t.completed).length;
  const totalCount = rangeTasks.length;
  if (totalCount > 0) {
    const rate = Math.round((doneCount / totalCount) * 100);
    insights.push({
      icon: '✅',
      title: 'Task Momentum',
      desc: `You completed <b>${doneCount} of ${totalCount}</b> scheduled tasks in this period (<b>${rate}%</b> completion rate).`
    });
  }

  // 3. Consistency Streak
  const streak = studyStats.streakDays || 0;
  const longest = studyStats.longestStreak || streak;
  if (streak > 0) {
    insights.push({
      icon: '🔥',
      title: 'Active Study Consistency',
      desc: `You have an active <b>${streak}-day study streak</b>! Your all-time record is <b>${longest} days</b>.`
    });
  } else if (studyStats.totalSessions > 0) {
    insights.push({
      icon: '💡',
      title: 'Streak Opportunity',
      desc: `Complete a 25m Pomodoro session today to ignite a new consecutive study streak!`
    });
  }

  // 4. Overdue Task Alert (if any)
  const today = Dates.todayISO();
  const overdueCount = rangeTasks.filter(t => !t.completed && t.dueDate && t.dueDate < today).length;
  if (overdueCount > 0) {
    insights.push({
      icon: '⚠️',
      title: 'Attention Needed',
      desc: `You have <b>${overdueCount} overdue task${overdueCount === 1 ? '' : 's'}</b> in this timeframe. Focus on completing or rescheduling high-priority items.`
    });
  }

  // If no sessions or tasks yet
  if (!insights.length) {
    insights.push({
      icon: '🌱',
      title: 'Ready to Begin',
      desc: 'Start your first focus session and add tasks to unlock real productivity insights.'
    });
  }

  box.innerHTML = insights.map(item => `
    <div class="insight-card-item mb-3">
      <div class="insight-icon">${item.icon}</div>
      <div class="insight-content">
        <div class="insight-title font-bold">${App.escapeHtml(item.title)}</div>
        <div class="insight-desc text-muted" style="font-size:var(--fs-sm); line-height:1.4">${item.desc}</div>
      </div>
    </div>`).join('');
}

/* ==========================================================================
   9. Chronological Activity Timeline
   ========================================================================== */
function renderActivityTimeline() {
  const activities = Store.getActivity(20);
  const box = App.qs('#activityTimeline');
  if (!box) return;

  const countBadge = App.qs('#activityCountBadge');
  if (countBadge) {
    countBadge.textContent = `${activities.length} events`;
  }

  if (!activities.length) {
    box.innerHTML = `<p class="text-muted text-center" style="padding:var(--space-5) 0">No activity recorded yet.</p>`;
    return;
  }

  const icons = {
    task_complete: '✅',
    task_create: '📋',
    task_delete: '🗑️',
    session_finish: '⏱️',
    note_create: '📝',
    note_delete: '🗑️',
    subject_create: '📚',
    subject_delete: '🗑️'
  };

  box.innerHTML = activities.map(a => {
    const ts = a.timestamp || '';
    const dateStr = ts ? Dates.formatFull(ts.slice(0, 10)) : '';
    return `
      <div class="activity-item">
        <div class="activity-icon">${icons[a.type] || '📌'}</div>
        <div class="activity-content">
          <div class="activity-title">${App.escapeHtml(a.title)}</div>
          <div class="activity-time">${Dates.timeAgo(ts)}${dateStr ? ` (${dateStr})` : ''}</div>
        </div>
      </div>`;
  }).join('');
}
