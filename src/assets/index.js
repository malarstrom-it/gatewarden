/*
 * The index page script.
 *
 * It keeps the route list live without reloading the page: every few seconds
 * it asks the gateway for the registrations, patches the rows that changed
 * and leaves the rest of the page alone, so a button the user is about to
 * click keeps its focus.
 *
 * Everything that is said about a route is said in that route's own band,
 * under the row: a confirmation, a failure, a "copied". While a band is
 * open the page must not change under the user's hands, so a background
 * refresh is held until the band closes.
 *
 * No dependencies, no network calls except to this origin. The stylesheet is
 * Tailwind, compiled ahead of time and committed; nothing is compiled at
 * runtime.
 */

/*
 * The parts of the page that can be reasoned about without a browser. They
 * are kept here, apart from the DOM, so they can be tested: the refresh
 * policy decides what happens to the list, and the announcement decides
 * what a screen reader is told.
 */
(function (root) {
  'use strict';

  /** Do two lists of ids name the same routes? */
  function sameIds(left, right) {
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i += 1) {
      if (left.indexOf(right[i]) === -1) return false;
    }
    return true;
  }

  /**
   * The refresh policy.
   *
   * The page holds two lists: the ids that are on it, and the ids the last
   * poll saw. While a band is open under a route the page must not change
   * under the user's hands, so a list that no longer matches is *held* until
   * the band closes and then applied.
   */
  function createRefreshPlan() {
    var pageIds = [];
    var pollIds = [];
    var openBands = 0;
    var held = false;

    function identical() {
      return sameIds(pageIds, pollIds);
    }

    return {
      /** What the last poll saw. */
      observe: function (ids) {
        pollIds = ids;
      },
      /** What is on the page now. */
      applied: function (ids) {
        pageIds = ids;
        held = false;
      },
      /** A band was opened under a route. */
      openBand: function () {
        openBands += 1;
      },
      /** A band was closed. */
      closeBand: function () {
        openBands = Math.max(0, openBands - 1);
      },
      /** Is a band open? */
      bandsOpen: function () {
        return openBands > 0;
      },
      /** Hold the list that is waiting to be applied. */
      hold: function () {
        held = true;
      },
      /** Is a list waiting to be applied? */
      held: function () {
        return held;
      },
      /**
       * What to do with the list the server just sent: apply it, patch the
       * rows in place, or wait for the band to close.
       */
      decide: function () {
        if (identical()) {
          held = false;
          return 'patch';
        }
        if (openBands > 0) {
          held = true;
          return 'defer';
        }
        held = false;
        return 'apply';
      },
    };
  }

  /** The sentence the live region says when a route changes state. */
  function stateAnnouncement(branch, state) {
    return branch + ' is now ' + (state === 'up' ? 'up' : 'down');
  }

  root.TraefikPage = {
    sameIds: sameIds,
    createRefreshPlan: createRefreshPlan,
    stateAnnouncement: stateAnnouncement,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof document !== 'undefined') {
  (function () {
    'use strict';

    var POLL_INTERVAL_MS = 4000;
    var BAND_TIMEOUT_MS = 2600;
    var REMOVED_TIMEOUT_MS = 2200;

    var api = (typeof globalThis !== 'undefined' ? globalThis : this).TraefikPage;

    var listEl = document.getElementById('routes');
    var messageEl = document.getElementById('message');
    var countEl = document.getElementById('route-count');
    var answeringEl = document.getElementById('route-answering');
    var checkedEl = document.getElementById('checked-at');
    var announcerEl = document.getElementById('announcer');

    var plan = api.createRefreshPlan();
    /** id -> the band that is open under that route. */
    var bands = {};
    var messageTimer = null;

    function plural(count, one, many) {
      return count === 1 ? one : many;
    }

    /** Write a text only when it changed: a live region repeats what it says. */
    function setText(node, text) {
      if (!node || node.textContent === text) return;
      node.textContent = text;
    }

    /** Say something about the page itself. */
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

    /** Tell a screen reader what changed, once, when it changes. */
    function announce(text) {
      if (!announcerEl) return;
      announcerEl.textContent = text;
    }

    /** Bring a node into view, but only as far as it takes. */
    function reveal(node) {
      if (!node || !node.scrollIntoView) return;
      try {
        node.scrollIntoView({ block: 'nearest' });
      } catch (error) {
        node.scrollIntoView();
      }
    }

    /** The ids of the routes on the page. */
    function currentIds() {
      var ids = [];
      var list = listEl.querySelectorAll('.route-body');
      for (var i = 0; i < list.length; i += 1) {
        ids.push(list[i].getAttribute('data-registration-id'));
      }
      return ids;
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

    /** id -> { row, state, age } for every row currently on the page. */
    var rows = {};

    /** Update the masthead counters from the polled data. */
    function updateCounts(registrations) {
      var answering = 0;
      for (var i = 0; i < registrations.length; i += 1) {
        if (registrations[i].state === 'up') answering += 1;
      }
      setText(countEl, registrations.length + ' ' + plural(registrations.length, 'route', 'routes'));
      if (answeringEl) {
        setText(answeringEl, answering + ' up');
        answeringEl.classList.toggle('badge-up', answering > 0);
        answeringEl.classList.toggle('badge-down', answering === 0);
        answeringEl.title =
          answering +
          ' of ' +
          registrations.length +
          ' ' +
          plural(registrations.length, 'route', 'routes') +
          ' ' +
          plural(registrations.length, 'answers', 'answer');
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
          announce(api.stateAnnouncement(registration.branchSlug, registration.state));
        }
        if (entry.state) {
          setText(entry.state, registration.state === 'up' ? 'Up' : 'Down');
        }
        if (entry.age) {
          setText(entry.age, formatAge(registration.createdAt));
        }
      }
    }

    /** Where the focus is, so it can be put back after the list is rebuilt. */
    function captureFocus() {
      var active = document.activeElement;
      if (!active || !active.closest) return null;
      var owner = active.closest('[data-registration-id]');
      if (!owner) return null;
      return {
        id: owner.getAttribute('data-registration-id'),
        className: active.getAttribute('class'),
      };
    }

    /**
     * Put the focus back where it was. If that element is gone, the focus
     * goes to the first thing on the page that can hold it — never to the
     * document body, where the keyboard user would be lost.
     */
    function restoreFocus(focus) {
      if (!focus) return;
      var candidates = listEl.querySelectorAll('[data-registration-id="' + focus.id + '"]');
      for (var i = 0; i < candidates.length; i += 1) {
        if (candidates[i].className === focus.className) {
          candidates[i].focus();
          return;
        }
      }
      var first = listEl.querySelector('.route-address') || listEl.querySelector('.copy');
      if (first) {
        first.focus();
        return;
      }
      if (messageEl && messageEl.focus) messageEl.focus();
    }

    /**
     * The band under a route: where everything that is said about that route
     * is said — a confirmation, a failure, a "copied".
     */
    function openBand(row) {
      var id = row.getAttribute('data-registration-id');
      var existing = bands[id];
      if (existing) return existing;

      var band = document.createElement('tr');
      band.className = 'route-band';
      band.setAttribute('data-registration-id', id);
      band.setAttribute('data-state', row.getAttribute('data-state'));

      var cell = document.createElement('td');
      cell.setAttribute('colspan', '6');

      var box = document.createElement('div');
      box.className = 'route-band__box';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');

      var text = document.createElement('span');
      text.className = 'route-band__text';

      var actions = document.createElement('span');
      actions.className = 'route-band__actions';

      box.appendChild(text);
      box.appendChild(actions);
      cell.appendChild(box);
      band.appendChild(cell);
      row.parentNode.insertBefore(band, row.nextSibling);

      var handle = {
        row: row,
        band: band,
        box: box,
        text: text,
        actions: actions,
        closed: false,
        close: function () {
          closeBand(handle);
        },
      };

      bands[id] = handle;
      plan.openBand();
      reveal(band);
      return handle;
    }

    /** Close a band and apply whatever the page was holding for it. */
    function closeBand(handle) {
      if (!handle || handle.closed) return;
      handle.closed = true;
      if (handle.band.parentNode) handle.band.parentNode.removeChild(handle.band);
      var id = handle.row.getAttribute('data-registration-id');
      if (bands[id] === handle) delete bands[id];
      plan.closeBand();
      flushHeld();
    }

    /** Say something in a route's band. */
    function setBandText(handle, text, tone) {
      handle.text.textContent = text;
      if (tone) handle.text.setAttribute('data-tone', tone);
      else handle.text.removeAttribute('data-tone');
      reveal(handle.band);
    }

    /** Put the buttons of a band in place. */
    function setBandActions(handle, nodes) {
      handle.actions.textContent = '';
      for (var i = 0; i < nodes.length; i += 1) {
        handle.actions.appendChild(nodes[i]);
      }
    }

    /** Apply the list the page was holding, now that the band is closed. */
    function flushHeld() {
      if (plan.bandsOpen()) return;
      if (!plan.held()) return;
      refreshList();
    }

    /** Reload the list from the server, keeping the keyboard focus in place. */
    function refreshList() {
      var focus = captureFocus();
      return fetch('/api/routes', { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('the gateway answered ' + response.status);
          return response.text();
        })
        .then(function (html) {
          // The page must not change under an open band.
          if (plan.bandsOpen()) {
            plan.hold();
            return null;
          }
          listEl.innerHTML = html;
          indexRows();
          plan.applied(currentIds());
          restoreFocus(focus);
          return null;
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
            checkedEl.textContent =
              data && data.checkedAt ? formatClock(data.checkedAt) : formatClock(new Date().toISOString());
          }
          updateCounts(registrations);
          plan.observe(
            registrations.map(function (registration) {
              return registration.id;
            }),
          );
          var decision = plan.decide();
          if (decision === 'apply') return refreshList();
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
        var row = button && button.closest ? button.closest('.route-body') : null;
        if (row) {
          var handle = openBand(row);
          setBandText(handle, 'Copied ' + text, 'done');
          setBandActions(handle, []);
          setTimeout(function () {
            handle.close();
          }, BAND_TIMEOUT_MS);
        } else {
          say('Copied ' + text, 'done');
        }
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
      if (!row) return;

      var handle = openBand(row);
      setBandText(handle, 'Remove ' + button.getAttribute('data-branch') + '?');

      var no = document.createElement('button');
      no.type = 'button';
      no.className = 'btn btn-ghost confirm-no';
      no.textContent = 'Keep it';

      var yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'btn btn-outline confirm-yes';
      yes.textContent = 'Remove';
      yes.setAttribute('aria-label', 'Remove ' + button.getAttribute('data-host'));

      setBandActions(handle, [no, yes]);
      yes.focus();

      var restore = function () {
        // The focus goes back to the button before the band closes: the band
        // closing can apply a list that was held, and the focus has to
        // survive that swap.
        button.focus();
        handle.close();
      };

      no.addEventListener('click', restore);

      // Escape closes the confirmation and leaves the route alone.
      handle.band.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          restore();
        }
      });

      yes.addEventListener('click', function () {
        yes.disabled = true;
        no.disabled = true;
        removeRoute(button, yes, no, handle);
      });
    }

    /** Delete a route and say what happened, in that route's own band. */
    function removeRoute(button, yes, no, handle) {
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
            setBandText(handle, host + ' was already gone.', 'done');
            return null;
          }
          throw new Error('the gateway answered ' + response.status);
        })
        .then(function () {
          if (row) row.classList.add('route-body--leaving');
          setBandText(handle, 'Removed ' + host + '.', 'done');
          setBandActions(handle, []);
          setTimeout(function () {
            handle.close();
            if (row && row.parentNode) row.parentNode.removeChild(row);
            refreshList().then(function () {
              var first = listEl.querySelector('.route-body .copy') || listEl.querySelector('.copy');
              if (first) first.focus();
            });
          }, REMOVED_TIMEOUT_MS);
        })
        .catch(function (error) {
          yes.disabled = false;
          no.disabled = false;
          setBandText(handle, 'Could not remove ' + host + '. ' + error.message + '.', 'error');
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

    indexRows();
    plan.applied(currentIds());
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  })();
}
