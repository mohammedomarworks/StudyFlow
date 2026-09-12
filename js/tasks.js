/* ==========================================================================
   tasks.js — Upgraded Task Management Logic
   Features:
   - Add, Edit, Delete, Complete tasks with LocalStorage persistence.
   - Status Tabs: All, Active, Due Today, Overdue, Due Soon, Completed with live counts.
   - Suggested Next Task: Deterministic recommendation ("What should I do next?").
   - Workload Summary: Active duration calculation and active filter resetting.
   - Advanced In-Memory Sorting: Due date, Priority, Created date, Duration, Title.
   - Bulk Mode: Multi-select tasks to complete, reopen, or delete.
   - Contextual Empty States: Custom messaging for each status filter.
   ========================================================================== */

// Current view state driven by toolbar controls, tabs, and bulk mode
const view = {
  search: '',
  subject: '',
  status: 'all', // 'all' | 'active' | 'today' | 'overdue' | 'soon' | 'completed'
  priority: 'all',
  category: 'all',
  sort: 'due-asc',
  bulkMode: false,
  selectedTaskIds: new Set()
};

document.addEventListener('DOMContentLoaded', () => {
  readUrlParams();
  populateDropdowns();
  bindToolbar();
  bindTabs();
  bindBulkBar();
  bindModal();
  render();
});

/* ==========================================================================
   URL Parameter Parsing
   ========================================================================== */
function readUrlParams() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('search')) {
    view.search = params.get('search').toLowerCase();
    const input = App.qs('#searchInput');
    if (input) input.value = params.get('search');
  }

  if (params.has('subject')) {
    view.subject = params.get('subject');
  }

  if (params.has('status')) {
    const s = params.get('status').toLowerCase();
    const validStatuses = ['all', 'active', 'today', 'overdue', 'soon', 'completed'];
    if (validStatuses.includes(s)) {
      view.status = s;
    }
  }

  if (params.has('priority')) {
    const p = params.get('priority').toLowerCase();
    if (['high', 'medium', 'low'].includes(p)) {
      view.priority = p;
    }
  }

  if (params.has('edit')) {
    const editId = params.get('edit');
    setTimeout(() => openTaskModal(editId), 100);
  } else if (params.get('action') === 'new' || params.has('date')) {
    const prefillDate = params.get('date') || Dates.todayISO();
    setTimeout(() => openTaskModal(null, prefillDate), 100);
  }
}

/* ==========================================================================
   Populate Dropdowns
   ========================================================================== */
function populateDropdowns() {
  // 1. Subjects dropdowns
  const subjects = Store.getSubjects();
  const subOptions = subjects.map(s => `<option value="${s.id}">${App.escapeHtml(s.name)}</option>`).join('');

  App.qs('#filterSubject').insertAdjacentHTML('beforeend', subOptions);
  App.qs('#taskSubject').insertAdjacentHTML('beforeend', subOptions);

  if (view.subject) {
    App.qs('#filterSubject').value = view.subject;
  }

  // 2. Categories dropdown
  const catOptions = Store.TASK_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
  App.qs('#filterCategory').insertAdjacentHTML('beforeend', catOptions);

  // Sync initial select values
  if (view.status) App.qs('#filterStatus').value = view.status;
  if (view.priority) App.qs('#filterPriority').value = view.priority;
  if (view.sort) App.qs('#sortBy').value = view.sort;
}

/* ==========================================================================
   Toolbar Wiring
   ========================================================================== */
function bindToolbar() {
  // Search input with debounce
  App.qs('#searchInput').addEventListener('input', App.debounce(e => {
    view.search = e.target.value.trim().toLowerCase();
    render();
  }, 150));

  App.qs('#filterSubject').addEventListener('change', e => {
    view.subject = e.target.value;
    render();
  });

  App.qs('#filterStatus').addEventListener('change', e => {
    view.status = e.target.value;
    render();
  });

  App.qs('#filterPriority').addEventListener('change', e => {
    view.priority = e.target.value;
    render();
  });

  App.qs('#filterCategory').addEventListener('change', e => {
    view.category = e.target.value;
    render();
  });

  App.qs('#sortBy').addEventListener('change', e => {
    view.sort = e.target.value;
    render();
  });

  App.qs('#addTaskBtn').addEventListener('click', () => openTaskModal());

  // Bulk mode toggle button in page header
  App.qs('#bulkModeBtn').addEventListener('click', toggleBulkMode);
}

/* ==========================================================================
   Status Tabs Wiring & Rendering
   ========================================================================== */
function bindTabs() {
  const tabsContainer = App.qs('#taskTabs');
  if (!tabsContainer) return;

  tabsContainer.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    const tabStatus = btn.dataset.tab;
    if (view.status === tabStatus) return;

    view.status = tabStatus;
    const filterStatus = App.qs('#filterStatus');
    if (filterStatus) filterStatus.value = tabStatus;
    render();
  });
}

function renderTaskTabs() {
  const tabsContainer = App.qs('#taskTabs');
  if (!tabsContainer) return;

  // Base tasks for status tab counts: scoped to active subject filter if set
  const allTasks = Store.getTasks();
  const baseTasks = view.subject ? allTasks.filter(t => t.subjectId === view.subject) : allTasks;

  const counts = {
    all: baseTasks.length,
    active: 0,
    today: 0,
    overdue: 0,
    soon: 0,
    completed: 0
  };

  baseTasks.forEach(t => {
    if (t.completed) {
      counts.completed++;
    } else {
      counts.active++;
      const days = Dates.daysFromToday(t.dueDate);
      if (days !== null) {
        if (days < 0) counts.overdue++;
        if (days === 0) counts.today++;
        if (days >= 0 && days <= 3) counts.soon++;
      }
    }
  });

  const tabDefs = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'today', label: 'Due Today', count: counts.today },
    { id: 'overdue', label: 'Overdue', count: counts.overdue, urgent: counts.overdue > 0 },
    { id: 'soon', label: 'Due Soon', count: counts.soon },
    { id: 'completed', label: 'Completed', count: counts.completed }
  ];

  tabsContainer.innerHTML = tabDefs.map(tab => {
    const isActive = view.status === tab.id;
    const urgentClass = tab.urgent ? 'urgent' : '';
    const activeClass = isActive ? 'active' : '';
    return `
      <button type="button"
              class="task-tab ${activeClass} ${urgentClass}"
              role="tab"
              aria-selected="${isActive ? 'true' : 'false'}"
              data-tab="${tab.id}">
        <span>${tab.label}</span>
        <span class="task-tab__count">${tab.count}</span>
      </button>
    `;
  }).join('');
}

/* ==========================================================================
   Bulk Selection Bar Wiring
   ========================================================================== */
function toggleBulkMode() {
  view.bulkMode = !view.bulkMode;
  if (!view.bulkMode) {
    view.selectedTaskIds.clear();
  }
  render();
}

function bindBulkBar() {
  const selectAll = App.qs('#selectAllCheckbox');
  const cancelBtn = App.qs('#bulkCancelBtn');
  const completeBtn = App.qs('#bulkCompleteBtn');
  const activeBtn = App.qs('#bulkActiveBtn');
  const deleteBtn = App.qs('#bulkDeleteBtn');

  if (selectAll) {
    selectAll.addEventListener('change', e => {
      const visible = getVisibleTasks();
      if (e.target.checked) {
        visible.forEach(t => view.selectedTaskIds.add(t.id));
      } else {
        visible.forEach(t => view.selectedTaskIds.delete(t.id));
      }
      updateBulkState(visible);
      updateTaskCardSelections();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      view.bulkMode = false;
      view.selectedTaskIds.clear();
      render();
    });
  }

  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      if (view.selectedTaskIds.size === 0) {
        App.toast('No tasks selected', 'warning');
        return;
      }
      let count = 0;
      view.selectedTaskIds.forEach(id => {
        const t = Store.getTask(id);
        if (t && !t.completed) {
          Store.toggleTask(id);
          count++;
        }
      });
      if (count > 0) App.playChime('finish');
      App.toast(`Marked ${count} task${count === 1 ? '' : 's'} as completed! 🎉`, 'success');
      view.selectedTaskIds.clear();
      render();
    });
  }

  if (activeBtn) {
    activeBtn.addEventListener('click', () => {
      if (view.selectedTaskIds.size === 0) {
        App.toast('No tasks selected', 'warning');
        return;
      }
      let count = 0;
      view.selectedTaskIds.forEach(id => {
        const t = Store.getTask(id);
        if (t && t.completed) {
          Store.toggleTask(id);
          count++;
        }
      });
      App.toast(`Marked ${count} task${count === 1 ? '' : 's'} as active`, 'info');
      view.selectedTaskIds.clear();
      render();
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const count = view.selectedTaskIds.size;
      if (count === 0) {
        App.toast('No tasks selected', 'warning');
        return;
      }
      App.confirm({
        title: `Delete ${count} task${count === 1 ? '' : 's'}?`,
        message: 'The selected tasks will be permanently removed.',
        confirmText: 'Delete All',
        onConfirm: () => {
          view.selectedTaskIds.forEach(id => Store.deleteTask(id));
          App.toast(`Deleted ${count} task${count === 1 ? '' : 's'}`, 'info');
          view.selectedTaskIds.clear();
          render();
        }
      });
    });
  }
}

function updateBulkState(visibleTasks) {
  const bulkBar = App.qs('#bulkBar');
  const taskList = App.qs('#taskList');
  const bulkBtnText = App.qs('#bulkModeBtnText');
  const bulkBtn = App.qs('#bulkModeBtn');
  const countLabel = App.qs('#bulkSelectedCount');
  const selectAll = App.qs('#selectAllCheckbox');

  if (!bulkBar) return;

  if (view.bulkMode) {
    bulkBar.hidden = false;
    if (taskList) taskList.classList.add('selecting');
    if (bulkBtnText) bulkBtnText.textContent = 'Exit Selection';
    if (bulkBtn) {
      bulkBtn.classList.remove('btn-ghost');
      bulkBtn.classList.add('btn-secondary');
    }
  } else {
    bulkBar.hidden = true;
    if (taskList) taskList.classList.remove('selecting');
    if (bulkBtnText) bulkBtnText.textContent = 'Select';
    if (bulkBtn) {
      bulkBtn.classList.add('btn-ghost');
      bulkBtn.classList.remove('btn-secondary');
    }
  }

  if (countLabel) {
    countLabel.textContent = `${view.selectedTaskIds.size} selected`;
  }

  if (selectAll) {
    selectAll.checked = visibleTasks.length > 0 && visibleTasks.every(t => view.selectedTaskIds.has(t.id));
  }
}

function updateTaskCardSelections() {
  App.qsa('.task-item').forEach(card => {
    const id = card.dataset.id;
    const isSelected = view.selectedTaskIds.has(id);
    card.classList.toggle('selected', isSelected);
    const selectCheck = card.querySelector('[data-select]');
    if (selectCheck) selectCheck.checked = isSelected;
  });
}

/* ==========================================================================
   Deterministic Suggested Next Task
   Ranks active tasks to answer: "What should I do next?"
   ========================================================================== */
function getSuggestedTask(tasks) {
  const active = tasks.filter(t => !t.completed);
  if (!active.length) return null;

  const priorityRank = { high: 0, medium: 1, low: 2 };

  const sorted = [...active].sort((a, b) => {
    const daysA = a.dueDate ? Dates.daysFromToday(a.dueDate) : null;
    const daysB = b.dueDate ? Dates.daysFromToday(b.dueDate) : null;

    const isOverdueA = daysA !== null && daysA < 0;
    const isOverdueB = daysB !== null && daysB < 0;

    // 1. Overdue tasks come first (oldest due date / most overdue first)
    if (isOverdueA && !isOverdueB) return -1;
    if (!isOverdueA && isOverdueB) return 1;
    if (isOverdueA && isOverdueB) {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      const pDiff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
      if (pDiff !== 0) return pDiff;
      return (b.estimate || 0) - (a.estimate || 0);
    }

    // 2. Due today tasks come next
    const isTodayA = daysA === 0;
    const isTodayB = daysB === 0;
    if (isTodayA && !isTodayB) return -1;
    if (!isTodayA && isTodayB) return 1;
    if (isTodayA && isTodayB) {
      const pDiff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
      if (pDiff !== 0) return pDiff;
      return (b.estimate || 0) - (a.estimate || 0);
    }

    // 3. High priority tasks
    const pDiff = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
    if (pDiff !== 0) return pDiff;

    // 4. Upcoming due dates (earlier due date first)
    if (a.dueDate && b.dueDate) {
      const dDiff = a.dueDate.localeCompare(b.dueDate);
      if (dDiff !== 0) return dDiff;
    } else if (a.dueDate && !b.dueDate) {
      return -1;
    } else if (!a.dueDate && b.dueDate) {
      return 1;
    }

    // 5. Higher estimated workload first
    const estDiff = (b.estimate || 0) - (a.estimate || 0);
    if (estDiff !== 0) return estDiff;

    // 6. Title alphabetical tie-breaker
    return (a.title || '').localeCompare(b.title || '');
  });

  return sorted[0];
}

function renderSuggestedTask(visibleTasks) {
  const container = App.qs('#suggestedTaskContainer');
  if (!container) return;

  // Don't show recommendation if viewing completed tasks or if there are no visible tasks
  if (view.status === 'completed' || !visibleTasks.length) {
    container.innerHTML = '';
    return;
  }

  const task = getSuggestedTask(visibleTasks);
  if (!task) {
    container.innerHTML = '';
    return;
  }

  const subject = Store.getSubject(task.subjectId);
  const days = Dates.daysFromToday(task.dueDate);

  let reason = 'Recommended based on priority and deadline';
  let dueClass = '';
  let dueText = '';

  if (days !== null) {
    if (days < 0) {
      const absDays = Math.abs(days);
      reason = `⚠️ Overdue by ${absDays} day${absDays === 1 ? '' : 's'} — address this first!`;
      dueClass = 'text-danger font-semibold';
      dueText = `Overdue (${absDays}d ago)`;
    } else if (days === 0) {
      reason = '🎯 Due today — high priority!';
      dueClass = 'text-warning font-semibold';
      dueText = 'Due today';
    } else if (days === 1) {
      reason = '⏳ Due tomorrow';
      dueText = 'Due tomorrow';
    } else if (task.priority === 'high') {
      reason = '🔥 High priority upcoming deadline';
      dueText = `Due in ${days} days (${Dates.formatShort(task.dueDate)})`;
    } else if (days <= 3) {
      reason = `⏳ Due in ${days} days`;
      dueText = `Due in ${days} days (${Dates.formatShort(task.dueDate)})`;
    } else {
      dueText = `${Dates.formatShort(task.dueDate)} · ${Dates.relative(task.dueDate)}`;
    }
  }

  container.innerHTML = `
    <div class="suggested-card">
      <div class="suggested-card__head">
        <div class="suggested-card__tag">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Suggested Next Task
        </div>
        <div class="suggested-card__reason">${reason}</div>
      </div>
      <div class="suggested-card__body">
        <div class="suggested-card__content">
          <div class="suggested-card__title">${App.escapeHtml(task.title)}</div>
          <div class="suggested-card__meta">
            ${subject ? `<span class="badge badge-muted"><span class="dot" style="background:${subject.color}"></span>${App.escapeHtml(subject.name)}</span>` : ''}
            <span class="badge badge-muted priority-${task.priority}">● ${task.priority}</span>
            ${task.category && task.category !== 'General' ? `<span class="badge badge-category">${App.escapeHtml(task.category)}</span>` : ''}
            ${task.estimate ? `<span class="badge badge-estimate">⏱️ ${Dates.formatDuration(task.estimate)}</span>` : ''}
            ${dueText ? `<span class="${dueClass}">${dueIcon()} ${dueText}</span>` : ''}
          </div>
        </div>
        <div class="suggested-card__actions flex gap-2 wrap">
          <button type="button" class="btn btn-ghost btn-sm" data-complete-suggested="${task.id}" title="Complete this task">
            ✓ Complete
          </button>
          <a href="timer.html?taskId=${task.id}${task.subjectId ? `&subjectId=${task.subjectId}` : ''}&autostart=1" class="btn btn-primary btn-sm">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Start Focus
          </a>
        </div>
      </div>
    </div>
  `;

  const compBtn = container.querySelector('[data-complete-suggested]');
  if (compBtn) {
    compBtn.addEventListener('click', () => {
      Store.toggleTask(task.id);
      App.playChime('finish');
      App.toast('Task completed! 🎉', 'success');
      render();
    });
  }
}

/* ==========================================================================
   Summary Bar, Workload Calculation & Active Filters
   ========================================================================== */
function resetAllFilters() {
  view.search = '';
  view.subject = '';
  view.status = 'all';
  view.priority = 'all';
  view.category = 'all';

  const sInput = App.qs('#searchInput');
  const subSelect = App.qs('#filterSubject');
  const statSelect = App.qs('#filterStatus');
  const priSelect = App.qs('#filterPriority');
  const catSelect = App.qs('#filterCategory');

  if (sInput) sInput.value = '';
  if (subSelect) subSelect.value = '';
  if (statSelect) statSelect.value = 'all';
  if (priSelect) priSelect.value = 'all';
  if (catSelect) catSelect.value = 'all';

  render();
}

function renderSummaryAndWorkload(visibleTasks) {
  const countEl = App.qs('#resultCount');
  const workloadBadge = App.qs('#workloadBadge');
  const filterContainer = App.qs('#activeFiltersContainer');
  const total = Store.getTasks().length;

  // 1. Result count label
  if (countEl) {
    if (total === 0) {
      countEl.textContent = '';
    } else if (visibleTasks.length === total) {
      countEl.textContent = `${total} task${total === 1 ? '' : 's'}`;
    } else {
      countEl.textContent = `Showing ${visibleTasks.length} of ${total} task${total === 1 ? '' : 's'}`;
    }
  }

  // 2. Active estimated workload calculation
  if (workloadBadge) {
    const activeVisible = visibleTasks.filter(t => !t.completed);
    const totalMinutes = activeVisible.reduce((sum, t) => sum + (Number(t.estimate) || 0), 0);

    if (totalMinutes > 0) {
      workloadBadge.hidden = false;
      workloadBadge.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Active Workload: <b>${Dates.formatDuration(totalMinutes)}</b> (${activeVisible.length})</span>
      `;
    } else {
      workloadBadge.hidden = true;
      workloadBadge.innerHTML = '';
    }
  }

  // 3. Reset filters button if any filter is non-default
  if (filterContainer) {
    const hasActiveFilters = Boolean(
      view.search ||
      view.subject ||
      view.status !== 'all' ||
      view.priority !== 'all' ||
      view.category !== 'all'
    );

    if (hasActiveFilters) {
      filterContainer.innerHTML = `
        <button type="button" class="btn btn-ghost btn-xs text-primary" id="resetFiltersBtn" style="font-weight:600">
          ✕ Reset filters
        </button>
      `;
      const btn = App.qs('#resetFiltersBtn');
      if (btn) btn.addEventListener('click', resetAllFilters);
    } else {
      filterContainer.innerHTML = '';
    }
  }
}

/* ==========================================================================
   Filtering + Sorting Pipeline (In-Memory without mutating stored records)
   ========================================================================== */
function getVisibleTasks() {
  let tasks = Store.getTasks();
  const today = Dates.todayISO();

  // 1. Search filter: Title, Notes, Category
  if (view.search) {
    tasks = tasks.filter(t =>
      (t.title || '').toLowerCase().includes(view.search) ||
      (t.notes || '').toLowerCase().includes(view.search) ||
      (t.category || '').toLowerCase().includes(view.search)
    );
  }

  // 2. Subject filter
  if (view.subject) {
    tasks = tasks.filter(t => t.subjectId === view.subject);
  }

  // 3. Status filter
  if (view.status === 'active') {
    tasks = tasks.filter(t => !t.completed);
  } else if (view.status === 'completed') {
    tasks = tasks.filter(t => t.completed);
  } else if (view.status === 'overdue') {
    tasks = tasks.filter(t => !t.completed && t.dueDate && Dates.daysFromToday(t.dueDate) < 0);
  } else if (view.status === 'today') {
    tasks = tasks.filter(t => !t.completed && t.dueDate && Dates.daysFromToday(t.dueDate) === 0);
  } else if (view.status === 'soon') {
    tasks = tasks.filter(t => {
      if (t.completed || !t.dueDate) return false;
      const days = Dates.daysFromToday(t.dueDate);
      return days !== null && days >= 0 && days <= 3;
    });
  }

  // 4. Priority filter
  if (view.priority !== 'all') {
    tasks = tasks.filter(t => t.priority === view.priority);
  }

  // 5. Category filter
  if (view.category !== 'all') {
    tasks = tasks.filter(t => (t.category || 'General') === view.category);
  }

  // 6. In-Memory Sorting with Tie-Breakers
  const priorityRank = { high: 0, medium: 1, low: 2 };

  const sorted = [...tasks].sort((a, b) => {
    switch (view.sort) {
      case 'due-desc': {
        if (a.dueDate && b.dueDate) {
          const d = b.dueDate.localeCompare(a.dueDate);
          if (d !== 0) return d;
        } else if (a.dueDate && !b.dueDate) {
          return -1;
        } else if (!a.dueDate && b.dueDate) {
          return 1;
        }
        const p = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
        if (p !== 0) return p;
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'priority-high': {
        const p = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
        if (p !== 0) return p;
        if (a.dueDate && b.dueDate) {
          const d = a.dueDate.localeCompare(b.dueDate);
          if (d !== 0) return d;
        } else if (a.dueDate && !b.dueDate) {
          return -1;
        } else if (!a.dueDate && b.dueDate) {
          return 1;
        }
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'priority-low': {
        const p = (priorityRank[b.priority] ?? 1) - (priorityRank[a.priority] ?? 1);
        if (p !== 0) return p;
        if (a.dueDate && b.dueDate) {
          const d = a.dueDate.localeCompare(b.dueDate);
          if (d !== 0) return d;
        } else if (a.dueDate && !b.dueDate) {
          return -1;
        } else if (!a.dueDate && b.dueDate) {
          return 1;
        }
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'created-desc':
        return (b.createdAt || '').localeCompare(a.createdAt || '');

      case 'estimate-asc': {
        const estA = Number(a.estimate) || 0;
        const estB = Number(b.estimate) || 0;
        if (estA !== estB) return estA - estB;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'estimate-desc': {
        const estA = Number(a.estimate) || 0;
        const estB = Number(b.estimate) || 0;
        if (estA !== estB) return estB - estA;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return (a.title || '').localeCompare(b.title || '');
      }

      case 'title-asc':
        return (a.title || '').localeCompare(b.title || '');

      case 'due-asc':
      default: {
        if (a.dueDate && b.dueDate) {
          const d = a.dueDate.localeCompare(b.dueDate);
          if (d !== 0) return d;
        } else if (a.dueDate && !b.dueDate) {
          return -1;
        } else if (!a.dueDate && b.dueDate) {
          return 1;
        }
        const p = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
        if (p !== 0) return p;
        return (a.title || '').localeCompare(b.title || '');
      }
    }
  });

  return sorted;
}

/* ==========================================================================
   Render Pipeline
   ========================================================================== */
function render() {
  renderTaskTabs();
  const tasks = getVisibleTasks();
  renderSuggestedTask(tasks);
  renderSummaryAndWorkload(tasks);
  updateBulkState(tasks);

  const list = App.qs('#taskList');
  const total = Store.getTasks().length;

  if (!list) return;

  // Empty states
  if (!tasks.length) {
    if (total === 0) {
      list.innerHTML = emptyNoTasks();
      wireEmptyStateButton();
    } else if (view.status === 'overdue') {
      list.innerHTML = emptyNoOverdue();
    } else if (view.status === 'today') {
      list.innerHTML = emptyNoToday();
    } else if (view.status === 'active') {
      list.innerHTML = emptyNoActive();
      wireEmptyStateButton();
    } else if (view.status === 'completed') {
      list.innerHTML = emptyNoCompleted();
    } else {
      list.innerHTML = emptyNoMatches();
      wireResetFiltersButton();
    }
    return;
  }

  list.innerHTML = tasks.map(taskCardHTML).join('');
  wireTaskCards();
}

/* ==========================================================================
   Task Card HTML Generation
   ========================================================================== */
function taskCardHTML(t) {
  const subject = Store.getSubject(t.subjectId);
  const days = Dates.daysFromToday(t.dueDate);
  const isSelected = view.selectedTaskIds.has(t.id);

  let dueClass = '';
  let statusBadge = '';
  let cardClass = `task-item pri-${t.priority}`;
  let relativeDue = '';

  if (t.completed) {
    cardClass += ' done';
    statusBadge = `<span class="badge badge-success">✓ Completed</span>`;
    if (t.dueDate) {
      relativeDue = `${Dates.formatFull(t.dueDate)}`;
    }
  } else if (days !== null) {
    if (days < 0) {
      dueClass = 'due-overdue text-danger font-semibold';
      cardClass += ' is-overdue';
      const countDays = Math.abs(days);
      statusBadge = `<span class="badge badge-overdue">⚠️ Overdue (${countDays}d)</span>`;
      relativeDue = `Overdue by ${countDays} day${countDays === 1 ? '' : 's'} (${Dates.formatFull(t.dueDate)})`;
    } else if (days === 0) {
      dueClass = 'due-soon text-warning font-semibold';
      cardClass += ' is-today';
      statusBadge = `<span class="badge badge-warning">Due Today</span>`;
      relativeDue = `Due today (${Dates.formatFull(t.dueDate)})`;
    } else if (days === 1) {
      dueClass = 'due-soon';
      statusBadge = `<span class="badge badge-muted">Due Tomorrow</span>`;
      relativeDue = `Due tomorrow (${Dates.formatFull(t.dueDate)})`;
    } else if (days <= 3) {
      dueClass = 'due-soon';
      statusBadge = `<span class="badge badge-muted">Due in ${days}d</span>`;
      relativeDue = `Due in ${days} days (${Dates.formatFull(t.dueDate)})`;
    } else {
      relativeDue = `${Dates.formatFull(t.dueDate)} · ${Dates.relative(t.dueDate)}`;
    }
  }

  if (isSelected) {
    cardClass += ' selected';
  }

  return `
    <div class="${cardClass}" data-id="${t.id}">
      <input type="checkbox"
             class="check task-item__select"
             data-select
             ${isSelected ? 'checked' : ''}
             aria-label="Select task ${App.escapeHtml(t.title)}" />

      <input type="checkbox"
             class="check"
             data-toggle
             ${t.completed ? 'checked' : ''}
             aria-label="Mark task ${App.escapeHtml(t.title)} complete" />

      <div class="task-item__body">
        <div class="flex-between wrap gap-2" style="margin-bottom:4px">
          <div class="task-item__title">${App.escapeHtml(t.title)}</div>
          <div class="flex gap-2">${statusBadge}</div>
        </div>

        <div class="task-item__meta">
          ${subject ? `<span class="badge badge-muted"><span class="dot" style="background:${subject.color}"></span>${App.escapeHtml(subject.name)}</span>` : ''}
          <span class="badge badge-muted priority-${t.priority}">● ${t.priority}</span>
          ${t.category && t.category !== 'General' ? `<span class="badge badge-category">${App.escapeHtml(t.category)}</span>` : ''}
          ${t.estimate ? `<span class="badge badge-estimate">⏱️ ${Dates.formatDuration(t.estimate)}</span>` : ''}
          ${relativeDue ? `<span class="${dueClass}">${dueIcon()} ${relativeDue}</span>` : ''}
        </div>

        ${t.notes ? `<div class="task-item__notes">${App.escapeHtml(t.notes)}</div>` : ''}
      </div>

      <div class="task-item__actions">
        ${t.completed ? '' : `
          <a href="timer.html?taskId=${t.id}${t.subjectId ? `&subjectId=${t.subjectId}` : ''}&autostart=1"
             class="icon-btn"
             title="Start a focus session for this task"
             aria-label="Start a focus session for &quot;${App.escapeHtml(t.title)}&quot;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </a>
        `}
        <button type="button" class="icon-btn" data-edit title="Edit Task" aria-label="Edit &quot;${App.escapeHtml(t.title)}&quot;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
        <button type="button" class="icon-btn danger" data-delete title="Delete Task" aria-label="Delete &quot;${App.escapeHtml(t.title)}&quot;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
        </button>
      </div>
    </div>
  `;
}

function dueIcon() {
  return `<svg style="width:13px;height:13px;display:inline;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
}

/* ==========================================================================
   Wire Card Event Listeners
   ========================================================================== */
function wireTaskCards() {
  App.qsa('.task-item').forEach(card => {
    const id = card.dataset.id;

    // Bulk selection checkbox
    const selectCheck = card.querySelector('[data-select]');
    if (selectCheck) {
      selectCheck.addEventListener('change', e => {
        if (e.target.checked) {
          view.selectedTaskIds.add(id);
        } else {
          view.selectedTaskIds.delete(id);
        }
        updateBulkState(getVisibleTasks());
        card.classList.toggle('selected', e.target.checked);
      });
    }

    // Toggle complete checkbox
    const toggleCheck = card.querySelector('[data-toggle]');
    if (toggleCheck) {
      toggleCheck.addEventListener('change', () => {
        const done = Store.toggleTask(id);
        if (done) App.playChime('finish');
        App.toast(done ? 'Task completed! 🎉' : 'Marked as active', done ? 'success' : 'info');
        render();
      });
    }

    // Edit button
    const editBtn = card.querySelector('[data-edit]');
    if (editBtn) {
      editBtn.addEventListener('click', () => openTaskModal(id));
    }

    // Delete button
    const deleteBtn = card.querySelector('[data-delete]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const task = Store.getTask(id);
        if (!task) return;
        App.confirm({
          title: 'Delete task?',
          message: `"${task.title}" will be permanently removed.`,
          confirmText: 'Delete',
          onConfirm: () => {
            view.selectedTaskIds.delete(id);
            Store.deleteTask(id);
            App.toast('Task deleted', 'info');
            render();
          }
        });
      });
    }
  });
}

/* ==========================================================================
   Add / Edit Modal
   ========================================================================== */
function bindModal() {
  const modal = App.qs('#taskModal');
  App.bindModalClose(modal);
  App.qs('#taskForm').addEventListener('submit', handleSubmit);

  ['taskTitle', 'taskDue'].forEach(id => {
    const el = App.qs('#' + id);
    if (el) {
      el.addEventListener('input', e => e.target.closest('.field').classList.remove('invalid'));
    }
  });
}

function openTaskModal(id = null, prefillDate = null) {
  const form = App.qs('#taskForm');
  form.reset();
  App.qsa('.field').forEach(f => f.classList.remove('invalid'));

  if (id) {
    // Edit mode
    const t = Store.getTask(id);
    if (!t) return;
    App.qs('#taskModalTitle').textContent = 'Edit Task';
    App.qs('#taskId').value = t.id;
    App.qs('#taskTitle').value = t.title;
    App.qs('#taskSubject').value = t.subjectId || '';
    App.qs('#taskCategory').value = t.category || 'Assignment';
    App.qs('#taskPriority').value = t.priority || 'medium';
    App.qs('#taskDue').value = t.dueDate || '';
    App.qs('#taskEstimate').value = t.estimate || '';
    App.qs('#taskNotes').value = t.notes || '';
  } else {
    // Add mode
    App.qs('#taskModalTitle').textContent = 'Add Task';
    App.qs('#taskId').value = '';
    App.qs('#taskDue').value = prefillDate || Dates.todayISO();
    App.qs('#taskCategory').value = 'Assignment';
    App.qs('#taskPriority').value = 'medium';
    if (view.subject) {
      App.qs('#taskSubject').value = view.subject;
    }
  }
  App.openModal('#taskModal');
}

function handleSubmit(e) {
  e.preventDefault();

  const title = App.qs('#taskTitle').value.trim();
  const due = App.qs('#taskDue').value;
  let valid = true;

  if (title.length < 2) {
    markInvalid('f-title');
    valid = false;
  }
  if (!due) {
    markInvalid('f-due');
    valid = false;
  }

  if (!valid) {
    App.toast('Please fix the highlighted fields', 'error');
    return;
  }

  const data = {
    title,
    subjectId: App.qs('#taskSubject').value,
    category: App.qs('#taskCategory').value,
    priority: App.qs('#taskPriority').value,
    dueDate: due,
    estimate: Number(App.qs('#taskEstimate').value) || 0,
    notes: App.qs('#taskNotes').value.trim()
  };

  const id = App.qs('#taskId').value;
  if (id) data.id = id;

  Store.saveTask(data);
  App.closeModal('#taskModal');
  App.toast(id ? 'Task updated' : 'Task added', 'success');
  render();
}

function markInvalid(fieldId) {
  const el = App.qs('#' + fieldId);
  if (el) el.classList.add('invalid');
}

/* ==========================================================================
   Contextual Empty States
   ========================================================================== */
function emptyNoTasks() {
  return `
    <div class="empty">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
      <h3>No tasks yet</h3>
      <p>Create your first task to start organizing your studies.</p>
      <button type="button" class="btn btn-primary mt-4" data-empty-add>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Task
      </button>
    </div>`;
}

function emptyNoOverdue() {
  return `
    <div class="empty">
      <div class="empty__icon" style="color:var(--success)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
      <h3>No overdue tasks!</h3>
      <p>You're completely on top of your deadlines. Keep up the great momentum! 🎉</p>
    </div>`;
}

function emptyNoToday() {
  return `
    <div class="empty">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg></div>
      <h3>No tasks due today</h3>
      <p>You're all clear for today. Use this time to review upcoming subjects or take a rest.</p>
    </div>`;
}

function emptyNoActive() {
  return `
    <div class="empty">
      <div class="empty__icon" style="color:var(--success)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></div>
      <h3>All caught up!</h3>
      <p>You've completed every active task. Great job! Add a new task whenever you're ready.</p>
      <button type="button" class="btn btn-primary mt-4" data-empty-add>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Add Task
      </button>
    </div>`;
}

function emptyNoCompleted() {
  return `
    <div class="empty">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg></div>
      <h3>No completed tasks yet</h3>
      <p>Check off tasks as you finish them to track your study progress.</p>
    </div>`;
}

function emptyNoMatches() {
  return `
    <div class="empty">
      <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
      <h3>No matching tasks</h3>
      <p>Try adjusting your search query, priority, category or status filters.</p>
      <button type="button" class="btn btn-secondary mt-4" data-empty-reset>Reset filters</button>
    </div>`;
}

function wireEmptyStateButton() {
  const btn = App.qs('[data-empty-add]');
  if (btn) btn.addEventListener('click', () => openTaskModal());
}

function wireResetFiltersButton() {
  const btn = App.qs('[data-empty-reset]');
  if (btn) btn.addEventListener('click', resetAllFilters);
}
