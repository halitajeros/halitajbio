(function () {
  const questions = Array.isArray(window.BIOLOGY_QUESTIONS) ? window.BIOLOGY_QUESTIONS : [];

  const els = {
    questionCount: document.getElementById('questionCount'),
    scoreCorrect: document.getElementById('scoreCorrect'),
    scoreWrong: document.getElementById('scoreWrong'),
    jumpInput: document.getElementById('jumpInput'),
    jumpButton: document.getElementById('jumpButton'),
    searchInput: document.getElementById('searchInput'),
    searchButton: document.getElementById('searchButton'),
    shuffleButton: document.getElementById('shuffleButton'),
    restartButton: document.getElementById('restartButton'),
    reviewButton: document.getElementById('reviewButton'),
    progressLabel: document.getElementById('progressLabel'),
    progressBar: document.getElementById('progressBar'),
    questionText: document.getElementById('questionText'),
    feedback: document.getElementById('feedback'),
    options: document.getElementById('options'),
    reviewPanel: document.getElementById('reviewPanel'),
    reviewCount: document.getElementById('reviewCount'),
    reviewList: document.getElementById('reviewList'),
    prevButton: document.getElementById('prevButton'),
    nextButton: document.getElementById('nextButton'),
  };

  const storageKey = 'biology-quiz-atlas-state-v3';

  const state = {
    order: questions.map((_, index) => index),
    position: 0,
    selected: null,
    answered: false,
    answers: {},
    reviewOpen: false,
    scoreCorrect: 0,
    scoreWrong: 0,
  };

  function currentQuestionIndex() {
    return state.order[state.position];
  }

  function currentQuestion() {
    return questions[currentQuestionIndex()];
  }

  function recalculateScores() {
    let correctCount = 0;
    let wrongCount = 0;

    Object.values(state.answers).forEach((entry) => {
      if (!entry) return;
      if (entry.correct === true) correctCount += 1;
      if (entry.correct === false) wrongCount += 1;
    });

    state.scoreCorrect = correctCount;
    state.scoreWrong = wrongCount;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed.order) && parsed.order.length === questions.length) {
        const filteredOrder = parsed.order.filter((value) => Number.isInteger(value) && value >= 0 && value < questions.length);
        if (filteredOrder.length === questions.length) {
          state.order = filteredOrder;
        }
      }

      if (Number.isInteger(parsed.position)) {
        state.position = Math.min(Math.max(parsed.position, 0), Math.max(questions.length - 1, 0));
      }

      if (parsed.answers && typeof parsed.answers === 'object') {
        const restoredAnswers = {};
        Object.entries(parsed.answers).forEach(([key, value]) => {
          const questionIndex = Number.parseInt(key, 10);
          if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= questions.length) return;
          if (!value || !Number.isInteger(value.selected)) return;
          if (value.correct !== true && value.correct !== false && value.correct !== null) return;
          restoredAnswers[String(questionIndex)] = {
            selected: value.selected,
            correct: value.correct,
          };
        });
        state.answers = restoredAnswers;
      }

      if (typeof parsed.reviewOpen === 'boolean') {
        state.reviewOpen = parsed.reviewOpen;
      }
    } catch {
      state.order = questions.map((_, index) => index);
      state.position = 0;
      state.answers = {};
      state.reviewOpen = false;
    }

    recalculateScores();
  }

  function saveState() {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        order: state.order,
        position: state.position,
        answers: state.answers,
        reviewOpen: state.reviewOpen,
      }),
    );
  }

  function formatQuestionLabel() {
    return `Pyetja ${state.position + 1} nga ${questions.length}`;
  }

  function updateCounters() {
    els.questionCount.textContent = questions.length.toLocaleString();
    els.scoreCorrect.textContent = String(state.scoreCorrect);
    els.scoreWrong.textContent = String(state.scoreWrong);
  }

  function setFeedback(text, kind) {
    els.feedback.textContent = text;
    els.feedback.className = `feedback ${kind || ''}`.trim();
  }

  function animateTap(element) {
    if (!element) return;
    element.classList.remove('tap-animate');
    void element.offsetWidth;
    element.classList.add('tap-animate');
    window.setTimeout(() => element.classList.remove('tap-animate'), 260);
  }

  function resetAnswerState() {
    state.selected = null;
    state.answered = false;
    setFeedback('', '');
  }

  function toggleReview(force) {
    state.reviewOpen = typeof force === 'boolean' ? force : !state.reviewOpen;
    render();
  }

  function getWrongEntries() {
    return Object.entries(state.answers)
      .map(([questionIndexText, answer]) => {
        const questionIndex = Number.parseInt(questionIndexText, 10);
        const question = questions[questionIndex];
        if (!question || !answer || answer.correct !== false) return null;
        return {
          questionIndex,
          question,
          selected: answer.selected,
          selectedText: question.options[answer.selected] || '',
          correctText: question.correctIndex >= 0 ? question.options[question.correctIndex] || '' : '',
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.questionIndex - right.questionIndex);
  }

  function renderReviewPanel() {
    const wrongEntries = getWrongEntries();
    els.reviewCount.textContent = `${wrongEntries.length} gabime`;
    els.reviewButton.textContent = state.reviewOpen ? 'Mbyll rishikimin' : 'Rishiko gabimet';
    els.reviewPanel.hidden = !state.reviewOpen;
    els.reviewList.innerHTML = '';

    if (!state.reviewOpen) return;

    if (!wrongEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'review-empty';
      empty.textContent = 'S’ke gabime të ruajtura ende. Vazhdo duke zgjidhur pyetjet.';
      els.reviewList.appendChild(empty);
      return;
    }

    wrongEntries.forEach((entry) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'review-item';
      item.innerHTML = `
        <span class="review-number">Pyetja ${entry.questionIndex + 1}</span>
        <span class="review-question">${escapeHtml(entry.question)}</span>
        <span class="review-answer wrong-answer">Zgjedhja jote: ${escapeHtml(entry.selectedText || 'Pa përgjigje')}</span>
        <span class="review-answer correct-answer">E saktë: ${escapeHtml(entry.correctText || 'Nuk është shënuar në dokument')}</span>
      `;
      item.addEventListener('click', () => {
        animateTap(item);
        goToQuestionByIndex(entry.questionIndex);
      });
      els.reviewList.appendChild(item);
    });
  }

  function revealAnswer() {
    const question = currentQuestion();
    const buttons = Array.from(els.options.querySelectorAll('.option-button'));
    buttons.forEach((button, index) => {
      button.disabled = true;
      if (index === question.correctIndex) button.classList.add('correct-choice');
      if (state.selected === index && index !== question.correctIndex) button.classList.add('wrong-choice');
    });

    if (question.correctIndex < 0) {
      setFeedback('Kjo pyetje nuk ka përgjigje të shënuar me të kuqe në dokument.', 'wrong');
      return;
    }

    if (state.selected === question.correctIndex) {
      setFeedback('Saktë.', 'correct');
    } else {
      const answer = question.options[question.correctIndex];
      setFeedback(`Jo saktë. Përgjigjja e saktë: ${answer}`, 'wrong');
    }
  }

  function render() {
    if (!questions.length) {
      els.progressLabel.textContent = 'Nuk ka pyetje të ngarkuara';
      els.questionText.textContent = 'Së pari duhet të gjenerohet banka e pyetjeve.';
      els.options.innerHTML = '';
      els.prevButton.disabled = true;
      els.nextButton.disabled = true;
      els.jumpButton.disabled = true;
      els.searchButton.disabled = true;
      els.shuffleButton.disabled = true;
      els.restartButton.disabled = true;
      els.reviewButton.disabled = true;
      els.jumpInput.disabled = true;
      els.searchInput.disabled = true;
      els.reviewPanel.hidden = true;
      setFeedback('Importuesi nuk ka gjeneruar ende `questions.js`.', 'wrong');
      return;
    }

    const question = currentQuestion();
    const progress = ((state.position + 1) / questions.length) * 100;
    const savedAnswer = state.answers[String(currentQuestionIndex())];

    if (savedAnswer) {
      state.selected = savedAnswer.selected;
      state.answered = true;
    } else {
      state.selected = null;
      state.answered = false;
    }

    els.progressLabel.textContent = formatQuestionLabel();
    els.progressBar.style.width = `${progress}%`;
    els.questionText.textContent = question.question;
    els.jumpInput.value = String(state.order[state.position] + 1);
    els.prevButton.disabled = state.position === 0;
    els.nextButton.textContent = state.position === questions.length - 1 ? 'Përfundo' : 'Tjetra';
    els.nextButton.disabled = false;
    els.jumpButton.disabled = false;
    els.searchButton.disabled = false;
    els.shuffleButton.disabled = false;
    els.restartButton.disabled = false;
    els.reviewButton.disabled = false;
    els.jumpInput.disabled = false;
    els.searchInput.disabled = false;
    els.options.innerHTML = '';

    question.options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option-button';
      button.dataset.index = String(index);
      button.innerHTML = `
        <span class="option-letter">${String.fromCharCode(65 + index)}</span>
        <span class="option-text">${escapeHtml(option)}</span>
      `;
      button.addEventListener('click', () => handleChoice(index));
      els.options.appendChild(button);
    });

    if (!state.answered) {
      setFeedback('Zgjidh një përgjigje për të parë nëse është e saktë.', '');
    } else {
      revealAnswer();
    }

    updateCounters();
    renderReviewPanel();
    saveState();
  }

  function handleChoice(index) {
    if (state.answered) return;

    const question = currentQuestion();
    state.selected = index;
    state.answered = true;
    state.answers[String(currentQuestionIndex())] = {
      selected: index,
      correct: question.correctIndex < 0 ? null : index === question.correctIndex,
    };
    recalculateScores();
    render();
  }

  function goToPosition(nextPosition) {
    const clamped = Math.min(Math.max(nextPosition, 0), questions.length - 1);
    state.position = clamped;
    resetAnswerState();
    render();
  }

  function goToQuestionByIndex(questionIndex) {
    const nextPosition = state.order.indexOf(questionIndex);
    if (nextPosition < 0) return;
    state.position = nextPosition;
    resetAnswerState();
    render();
  }

  function searchQuestions() {
    const term = els.searchInput.value.trim().toLowerCase();
    if (!term) return;

    const numericMatch = Number.parseInt(term, 10);
    if (Number.isInteger(numericMatch)) {
      goToQuestionByIndex(numericMatch - 1);
      return;
    }

    const matchIndex = questions.findIndex((question) => {
      const haystack = `${question.question} ${question.options.join(' ')}`.toLowerCase();
      return haystack.includes(term);
    });

    if (matchIndex >= 0) {
      goToQuestionByIndex(matchIndex);
      return;
    }

    setFeedback('Nuk u gjet asnjë pyetje për këtë kërkim.', 'wrong');
  }

  function shuffleQuestions() {
    for (let index = state.order.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [state.order[index], state.order[swapIndex]] = [state.order[swapIndex], state.order[index]];
    }
    state.position = 0;
    resetAnswerState();
    render();
  }

  function restartQuiz() {
    state.order = questions.map((_, index) => index);
    state.position = 0;
    state.answers = {};
    state.reviewOpen = false;
    state.scoreCorrect = 0;
    state.scoreWrong = 0;
    resetAnswerState();
    render();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  els.prevButton.addEventListener('click', (event) => {
    animateTap(event.currentTarget);
    goToPosition(state.position - 1);
  });

  els.nextButton.addEventListener('click', (event) => {
    animateTap(event.currentTarget);
    goToPosition(Math.min(state.position + 1, questions.length - 1));
  });

  els.jumpButton.addEventListener('click', (event) => {
    animateTap(event.currentTarget);
    const target = Number.parseInt(els.jumpInput.value, 10);
    if (Number.isInteger(target)) goToPosition(target - 1);
  });

  els.searchButton.addEventListener('click', (event) => {
    animateTap(event.currentTarget);
    searchQuestions();
  });

  els.shuffleButton.addEventListener('click', (event) => {
    animateTap(event.currentTarget);
    shuffleQuestions();
  });

  els.restartButton.addEventListener('click', (event) => {
    animateTap(event.currentTarget);
    restartQuiz();
  });

  els.reviewButton.addEventListener('click', (event) => {
    animateTap(event.currentTarget);
    toggleReview();
  });

  els.jumpInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      els.jumpButton.click();
    }
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      els.searchButton.click();
    }
  });

  loadState();
  updateCounters();
  render();
})();
