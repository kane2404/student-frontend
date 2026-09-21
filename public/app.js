(() => {
  'use strict';

  const PAGE_SIZE = 20;
  const STATUTS = { inscrit: 'Inscrit', diplome: 'Diplômé', suspendu: 'Suspendu' };
  const ONGLETS = [
    { valeur: '', label: 'Tous', cle: 'total' },
    { valeur: 'inscrit', label: 'Inscrits', cle: 'inscrit' },
    { valeur: 'diplome', label: 'Diplômés', cle: 'diplome' },
    { valeur: 'suspendu', label: 'Suspendus', cle: 'suspendu' },
  ];
  const CHAMPS = ['prenom', 'nom', 'email', 'date_naissance', 'filiere', 'niveau', 'statut'];

  const $ = (selector) => document.querySelector(selector);

  const state = {
    statut: '',
    filiere: '',
    search: '',
    page: 1,
    stats: null,
    list: null, // { data, meta }
  };
  let listRequest = 0;
  let toastTimer = null;
  let searchTimer = null;
  let editing = null; // étudiant en cours de modification, ou null pour un ajout
  let deleting = null;

  // ---------- Utilitaires ----------

  /** Crée un élément DOM ; le texte est toujours inséré via textContent (pas d'injection HTML). */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  }

  const formatDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network', 'Le serveur est injoignable. Vérifiez votre connexion puis réessayez.');
    }
    if (res.status === 204) return null;

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* corps non JSON (ex. page d'erreur d'un proxy) */
    }
    if (!res.ok) {
      const err = payload && payload.error;
      const fallback = res.status >= 500
        ? 'Le serveur ne répond pas correctement. Réessayez dans un instant.'
        : `La requête a échoué (code ${res.status}).`;
      throw new ApiError(res.status, (err && err.code) || 'error', (err && err.message) || fallback, err && err.details);
    }
    return payload;
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
  }

  // ---------- Chargement des données ----------

  async function loadStats() {
    state.stats = await api('GET', '/api/stats');
    if (state.filiere && !state.stats.par_filiere.some((f) => f.filiere === state.filiere)) {
      state.filiere = '';
    }
    renderTabs();
    renderFiliereFilter();
    renderFiliereSuggestions();
  }

  async function loadStudents() {
    const request = ++listRequest;
    $('#table').setAttribute('aria-busy', 'true');

    const params = new URLSearchParams({ page: String(state.page), limit: String(PAGE_SIZE) });
    if (state.search) params.set('search', state.search);
    if (state.filiere) params.set('filiere', state.filiere);
    if (state.statut) params.set('statut', state.statut);

    try {
      const result = await api('GET', `/api/students?${params}`);
      if (request !== listRequest) return; // une requête plus récente a pris le relais
      if (result.meta.page > result.meta.pages) {
        state.page = result.meta.pages; // dernière page vidée : on recule
        return loadStudents();
      }
      state.list = result;
      hideNotice();
      renderList();
    } catch (err) {
      if (request !== listRequest) return;
      showNotice(err.message);
    } finally {
      if (request === listRequest) $('#table').removeAttribute('aria-busy');
    }
  }

  async function refreshAll() {
    try {
      await Promise.all([loadStats(), loadStudents()]);
    } catch (err) {
      showNotice(err.message);
    }
  }

  // ---------- Rendu ----------

  function showNotice(message) {
    $('#notice-text').textContent = message;
    $('#notice').hidden = false;
  }
  const hideNotice = () => { $('#notice').hidden = true; };

  function renderTabs() {
    const stats = state.stats;
    const nav = $('#tabs');
    nav.replaceChildren(
      ...ONGLETS.map((tab) => {
        const count = stats ? (tab.cle === 'total' ? stats.total : stats.par_statut[tab.cle]) : '';
        return h(
          'button',
          {
            class: 'onglet',
            type: 'button',
            'aria-pressed': String(state.statut === tab.valeur),
            onclick: () => {
              state.statut = tab.valeur;
              state.page = 1;
              renderTabs();
              loadStudents();
            },
          },
          h('span', { text: tab.label }),
          h('span', { class: 'compte', text: String(count) }),
        );
      }),
    );
  }

  function renderFiliereFilter() {
    const select = $('#filter-filiere');
    const filieres = state.stats ? state.stats.par_filiere : [];
    select.replaceChildren(
      h('option', { value: '', text: 'Toutes les filières' }),
      ...filieres.map((f) => h('option', { value: f.filiere, text: `${f.filiere} (${f.total})` })),
    );
    select.value = state.filiere;
  }

  function renderFiliereSuggestions() {
    const filieres = state.stats ? state.stats.par_filiere : [];
    $('#filieres-list').replaceChildren(...filieres.map((f) => h('option', { value: f.filiere })));
  }

  function renderList() {
    const { data, meta } = state.list;
    const rows = $('#rows');
    rows.replaceChildren(...data.map(renderRow));

    const hasFilters = Boolean(state.search || state.filiere || state.statut);
    const isEmpty = data.length === 0;

    $('#table').hidden = isEmpty;
    $('#empty').hidden = !isEmpty;
    if (isEmpty) {
      $('#empty-text').textContent = hasFilters
        ? 'Aucun étudiant ne correspond à ces critères. Modifiez la recherche ou les filtres.'
        : 'Le registre est vide. Ajoutez le premier étudiant pour commencer.';
      $('#empty-add').hidden = hasFilters;
    }

    const pagination = $('#pagination');
    pagination.hidden = isEmpty;
    if (!isEmpty) {
      const first = (meta.page - 1) * meta.limit + 1;
      const last = first + data.length - 1;
      $('#page-info').textContent = `${first} à ${last} sur ${meta.total}`;
      $('#prev').disabled = meta.page <= 1;
      $('#next').disabled = meta.page >= meta.pages;
    }
  }

  function renderRow(student) {
    const fullName = `${student.prenom} ${student.nom}`;
    return h(
      'tr',
      {},
      h('td', { class: 'c-num', text: student.numero }),
      h(
        'td',
        { class: 'c-name' },
        h(
          'span',
          { class: 'etudiant' },
          h('span', {}, h('span', { class: 'nom', text: student.nom }), ` ${student.prenom}`),
          h('span', { class: 'email', text: student.email, title: student.email }),
        ),
      ),
      h('td', { class: 'c-birth', text: formatDate(student.date_naissance) }),
      h('td', { class: 'c-filiere', text: student.filiere }),
      h('td', { class: 'c-niveau', text: student.niveau }),
      h('td', { class: 'c-meta', text: `${student.filiere}, ${student.niveau}` }),
      h(
        'td',
        { class: 'c-statut' },
        h('span', { class: `pastille pastille-${student.statut}`, text: STATUTS[student.statut] || student.statut }),
      ),
      h(
        'td',
        { class: 'c-actions' },
        h('button', {
          class: 'lien',
          type: 'button',
          text: 'Modifier',
          'aria-label': `Modifier ${fullName}`,
          onclick: () => openForm(student),
        }),
        h('button', {
          class: 'lien lien-danger',
          type: 'button',
          text: 'Supprimer',
          'aria-label': `Supprimer ${fullName}`,
          onclick: () => openDelete(student),
        }),
      ),
    );
  }

  // ---------- Formulaire d'ajout / modification ----------

  function clearFormErrors() {
    $('#form-error').hidden = true;
    for (const champ of CHAMPS) {
      const message = $(`#e-${champ}`);
      const input = $(`#f-${champ}`);
      message.hidden = true;
      message.textContent = '';
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function showFieldErrors(details) {
    let firstInvalid = null;
    for (const champ of CHAMPS) {
      if (!details[champ]) continue;
      const message = $(`#e-${champ}`);
      const input = $(`#f-${champ}`);
      message.textContent = details[champ];
      message.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', message.id);
      if (!firstInvalid) firstInvalid = input;
    }
    if (firstInvalid) firstInvalid.focus();
    return Boolean(firstInvalid);
  }

  function openForm(student = null) {
    editing = student;
    clearFormErrors();
    $('#dialog-title').textContent = student ? `Modifier ${student.prenom} ${student.nom}` : 'Ajouter un étudiant';
    $('#form-submit').textContent = student ? 'Enregistrer les modifications' : 'Ajouter l\'étudiant';
    for (const champ of CHAMPS) {
      $(`#f-${champ}`).value = student ? student[champ] : champ === 'niveau' ? 'L1' : champ === 'statut' ? 'inscrit' : '';
    }
    $('#student-dialog').showModal();
    $('#f-prenom').focus();
  }

  async function submitForm(event) {
    event.preventDefault();
    clearFormErrors();

    const payload = {};
    for (const champ of CHAMPS) payload[champ] = $(`#f-${champ}`).value;

    const button = $('#form-submit');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Enregistrement…';

    try {
      if (editing) await api('PUT', `/api/students/${editing.id}`, payload);
      else await api('POST', '/api/students', payload);

      const wasEditing = Boolean(editing);
      $('#student-dialog').close();
      toast(wasEditing ? 'Modifications enregistrées' : 'Étudiant ajouté');
      await refreshAll();
    } catch (err) {
      const shown = err.details && showFieldErrors(err.details);
      if (!shown) {
        const box = $('#form-error');
        box.textContent = err.message;
        box.hidden = false;
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  // ---------- Suppression ----------

  function openDelete(student) {
    deleting = student;
    $('#delete-error').hidden = true;
    $('#delete-title').textContent = `Supprimer ${student.prenom} ${student.nom} ?`;
    $('#delete-dialog').showModal();
    $('#delete-cancel').focus();
  }

  async function confirmDelete(event) {
    event.preventDefault();
    const button = $('#delete-confirm');
    button.disabled = true;
    try {
      await api('DELETE', `/api/students/${deleting.id}`);
      $('#delete-dialog').close();
      toast('Étudiant supprimé');
      await refreshAll();
    } catch (err) {
      if (err.status === 404) {
        // déjà supprimé ailleurs : on ferme et on rafraîchit
        $('#delete-dialog').close();
        await refreshAll();
      } else {
        const box = $('#delete-error');
        box.textContent = err.message;
        box.hidden = false;
      }
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Initialisation ----------

  function init() {
    renderTabs();
    renderFiliereFilter();

    $('#btn-add').addEventListener('click', () => openForm());
    $('#empty-add').addEventListener('click', () => openForm());
    $('#student-form').addEventListener('submit', submitForm);
    $('#form-cancel').addEventListener('click', () => $('#student-dialog').close());
    $('#delete-form').addEventListener('submit', confirmDelete);
    $('#delete-cancel').addEventListener('click', () => $('#delete-dialog').close());
    $('#notice-retry').addEventListener('click', refreshAll);

    $('#search').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = event.target.value.trim();
        state.page = 1;
        loadStudents();
      }, 250);
    });

    $('#filter-filiere').addEventListener('change', (event) => {
      state.filiere = event.target.value;
      state.page = 1;
      loadStudents();
    });

    $('#prev').addEventListener('click', () => {
      if (state.page > 1) { state.page -= 1; loadStudents(); }
    });
    $('#next').addEventListener('click', () => {
      if (state.list && state.page < state.list.meta.pages) { state.page += 1; loadStudents(); }
    });

    refreshAll();
  }

  init();
})();
