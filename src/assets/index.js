/*
 * The index page script.
 *
 * It keeps the route list live without reloading the page: every few seconds
 * it asks the gateway for the registrations, patches the rows that changed
 * and leaves the rest of the page alone, so a button the user is about to
 * click keeps its focus.
 *
 * No dependencies, no network calls except to this origin. The stylesheet is
 * Tailwind, compiled ahead of time and committed; nothing is compiled at
 * runtime.
 */
(function () {
  'use strict';

  var POLL_INTERVAL_MS = 4000;

  var listEl = document.getElementById('routes');
  var messageEl = document.getElementById('message');
  var countEl = document.getElementById('route-count');
  var answeringEl = document.getElementById('route-answering');
  var checkedEl = document.getElementById('checked-at');

  /** id -> { row, state, age } for every row currently on the page. */
  var rows = {};
  /** The registration ids the page was built for, used to detect new work. */
  var knownIds = [];
  var messageTimer = null;

  function plural(count, one, many) {
    return count === 1 ? one : many;
  }

  function say(text, tone) {
    if (!messageEl) return;
    messageEl.textContent = text;
    if (tone) messageEl.setAttribute('data-tone', tone);
    else messageEl.removeAttribute('data-tone');
    if (messageTimer) clearTimeout(messageTimer);
    if (text) {
      messageTimer = setTimeout(function () {
        messageEl.textContent = '';
        messageEl.removeAttribute('data-tone');
      }, 6000);
    }
  }

  function formatClock(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '--:--:--';
    function pad(value) {
      return String(value).padStart(2, '0');
    }
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function formatAge(iso) {
    var then = Date.parse(iso);
    if (isNaN(then)) return 'just now';
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 45) return 'just now';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return plural(minutes, '1 minute', minutes + ' minutes') + ' ago';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return plural(hours, '1 hour', hours + ' hours') + ' ago';
    var days = Math.round(hours / 24);
    return plural(days, '1 day', days + ' days') + ' ago';
  }

  /** Remember the rows the page shows, so updates can be made in place. */
  function indexRows() {
    rows = {};
    var list = listEl.querySelectorAll('.route-body');
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      rows[row.getAttribute('data-registration-id')] = {
        row: row,
        state: row.querySelector('.route-state'),
        age: row.querySelector('.route-age'),
      };
    }
  }

  /** Update the masthead counters from the polled data. */
  function updateCounts(registrations) {
    var answering = 0;
    for (var i = 0; i < registrations.length; i += 1) {
      if (registrations[i].state === 'up') answering += 1;
    }
    if (countEl) countEl.textContent = registrations.length + ' ' + plural(registrations.length, 'route', 'routes');
    if (answeringEl) {
      answeringEl.textContent = answering + ' up';
      answeringEl.classList.toggle('badge-up', answering > 0);
      answeringEl.classList.toggle('badge-down', answering === 0);
      answeringEl.title =
        answering + ' of ' + registrations.length + ' ' + plural(registrations.length, 'route', 'routes') + ' ' + plural(registrations.length, 'answers', 'answer');
    }
  }

  /**
   * Patch the rows that changed. A row is never rebuilt, so the focus stays
   * where the user put it.
   */
  function patchRows(registrations) {
    for (var i = 0; i < registrations.length; i += 1) {
      var registration = registrations[i];
      var entry = rows[registration.id];
      if (!entry) continue;
      var row = entry.row;
      if (row.getAttribute('data-state') !== registration.state) {
        row.setAttribute('data-state', registration.state);
        row.classList.add('route-body--changed');
        setTimeout(function (element) {
          return function () {
            element.classList.remove('route-body--changed');
          };
        }(row), 1000);
      }
      if (entry.state) {
        entry.state.textContent = registration.state === 'up' ? 'Up' : 'Down';
      }
      if (entry.age) {
        entry.age.textContent = formatAge(registration.createdAt);
      }
    }
  }

  /** True when a registration id is on the page that the poll does not know. */
  function membershipChanged(registrations) {
    if (registrations.length !== knownIds.length) return true;
    for (var i = 0; i < registrations.length; i += 1) {
      if (knownIds.indexOf(registrations[i].id) === -1) return true;
    }
    return false;
  }

  /** Reload the list from the server, keeping the keyboard focus in place. */
  function refreshList() {
    var active = document.activeElement;
    var focusId = null;
    var focusClass = null;
    if (active && active.closest) {
      var owner = active.closest('[data-registration-id]');
      if (owner) {
        focusId = owner.getAttribute('data-registration-id');
        focusClass = active.getAttribute('class');
      }
    }

    return fetch('/api/routes', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('the gateway answered ' + response.status);
        return response.text();
      })
      .then(function (html) {
        listEl.innerHTML = html;
        indexRows();
        if (focusId) {
          var owner = null;
          var candidates = listEl.querySelectorAll('[data-registration-id="' + focusId + '"]');
          for (var i = 0; i < candidates.length; i += 1) {
            if (candidates[i].className === focusClass) {
              owner = candidates[i];
              break;
            }
          }
          if (owner) owner.focus();
        }
      });
  }

  /** One poll: read the registrations and update the page. */
  function poll() {
    return fetch('/api/registrations', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('the gateway answered ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var registrations = (data && data.registrations) || [];
        if (checkedEl) {
          checkedEl.textContent = data && data.checkedAt ? formatClock(data.checkedAt) : formatClock(new Date().toISOString());
        }
        updateCounts(registrations);
        if (membershipChanged(registrations)) {
          knownIds = registrations.map(function (registration) {
            return registration.id;
          });
          return refreshList();
        }
        patchRows(registrations);
        return null;
      })
      .catch(function (error) {
        say('Lost contact with the gateway: ' + error.message + '. Trying again.', 'error');
      });
  }

  /** Copy text to the clipboard and say so in the interface's own words. */
  function copyText(text, button) {
    var done = function () {
      if (button) {
        if (button.getAttribute('data-icon')) {
          // An icon button has no word to swap: it takes the colour of the
          // good news for a moment instead.
          button.classList.add('is-done');
          setTimeout(function () {
            button.classList.remove('is-done');
          }, 1600);
        } else {
          var original = button.getAttribute('data-label') || button.textContent;
          button.setAttribute('data-label', original);
          button.textContent = 'Copied';
          button.disabled = true;
          setTimeout(function () {
            button.textContent = original;
            button.disabled = false;
          }, 1600);
        }
      }
      say('Copied ' + text);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        say('Could not copy ' + text + '. Copy it from the page instead.', 'error');
      });
      return;
    }
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var copied = document.execCommand('copy');
      document.body.removeChild(area);
      if (copied) done();
      else say('Could not copy ' + text + '. Copy it from the page instead.', 'error');
    } catch (error) {
      say('Could not copy ' + text + '. Copy it from the page instead.', 'error');
    }
  }

  /** Replace the row actions with a confirmation the user has to answer. */
  function askToRemove(button) {
    var row = button.closest('.route-body');
    var host = button.getAttribute('data-host');
    if (!row) return;

    // The confirmation gets a row of its own, under the route it is about,
    // so it never squeezes the table it belongs to.
    var confirmRow = document.createElement('tr');
    confirmRow.className = 'route-confirm-row';

    var cell = document.createElement('td');
    cell.setAttribute('colspan', '6');

    var confirm = document.createElement('div');
    confirm.className = 'route-confirm';

    var question = document.createElement('span');
    question.className = 'route-confirm-text';
    question.textContent = 'Remove ' + button.getAttribute('data-branch') + '?';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn btn-outline confirm-yes';
    yes.textContent = 'Remove';
    yes.setAttribute('aria-label', 'Remove ' + host);

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn btn-ghost confirm-no';
    no.textContent = 'Keep it';

    confirm.appendChild(question);
    confirm.appendChild(no);
    confirm.appendChild(yes);

    cell.appendChild(confirm);
    confirmRow.appendChild(cell);
    row.parentNode.insertBefore(confirmRow, row.nextSibling);
    yes.focus();

    var restore = function () {
      if (confirmRow.parentNode) confirmRow.parentNode.removeChild(confirmRow);
      button.focus();
    };

    no.addEventListener('click', restore);

    yes.addEventListener('click', function () {
      yes.disabled = true;
      no.disabled = true;
      removeRoute(button, yes, no, confirmRow);
    });
  }

  /** Delete a route and show the outcome where it happened. */
  function removeRoute(button, yes, no, confirmRow) {
    var id = button.getAttribute('data-registration-id');
    var project = button.getAttribute('data-project');
    var branch = button.getAttribute('data-branch');
    var host = button.getAttribute('data-host');
    var row = button.closest('.route-body');

    fetch('/api/registrations/' + encodeURIComponent(project) + '/' + encodeURIComponent(branch), {
      method: 'DELETE',
      headers: { 'X-Gateway-UI': '1' },
    })
      .then(function (response) {
        if (response.status === 204) return null;
        if (response.status === 404) {
          say(host + ' was already gone.');
          return null;
        }
        throw new Error('the gateway answered ' + response.status);
      })
      .then(function () {
        if (row) row.classList.add('route-body--leaving');
        if (confirmRow && confirmRow.parentNode) confirmRow.parentNode.removeChild(confirmRow);
        say('Removed ' + host + '.', 'done');
        setTimeout(function () {
          knownIds = knownIds.filter(function (known) {
            return known !== id;
          });
          if (row && row.parentNode) row.parentNode.removeChild(row);
          refreshList().then(function () {
            var first = listEl.querySelector('.route-body .copy') || listEl.querySelector('.copy');
            if (first) first.focus();
          });
        }, 220);
      })
      .catch(function (error) {
        yes.disabled = false;
        no.disabled = false;
        // The failure belongs to the row the user is looking at, so it is
        // said there and not only at the top of the page.
        var confirm = yes.closest ? yes.closest('.route-confirm') : null;
        if (confirm) {
          var problem = document.createElement('span');
          problem.className = 'route-error';
          problem.setAttribute('role', 'alert');
          problem.textContent = 'Could not remove ' + host + '. ' + error.message + '.';
          confirm.appendChild(problem);
        }
      });
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;

    var copy = target.closest('.copy');
    if (copy) {
      var text = copy.getAttribute('data-copy');
      if (text) copyText(text, copy);
      return;
    }

    var remove = target.closest('.remove');
    if (remove) askToRemove(remove);
  });

  indexRows();
  knownIds = Object.keys(rows);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
})();
