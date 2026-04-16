/*
 * Russian dictionary. RU is the source-of-truth locale: other languages
 * are typed against `Dict = typeof ru` so forgotten keys surface at compile
 * time. Strings are split by surface (common / landing / auth / ...).
 * Spec: docs/superpowers/specs/2026-04-16-product-ux-visual-design.md §6.
 */

/* Exported as a plain (non-`as const`) object so the EN dictionary can
 * satisfy the same structural type without matching literal unions. */
const ru: {
  lang: { name: string; full: string }
  common: Record<
    | 'login'
    | 'loading'
    | 'back'
    | 'next'
    | 'skip'
    | 'done'
    | 'cancel'
    | 'retry'
    | 'copy'
    | 'languageSwitch',
    string
  >
  palette: {
    open: string
    hint: string
    placeholder: string
    empty: string
    groups: { navigate: string; actions: string; recent: string; admin: string }
    cmd: {
      goStudio: string
      goSimple: string
      goCompare: string
      goLibrary: string
      goCommunity: string
      goModels: string
      goWorkspaces: string
      goPresets: string
      goSettings: string
      goUserInfo: string
      goHelp: string
      goAdmin: string
      themeLight: string
      themeDark: string
      langRu: string
      langEn: string
      signOut: string
      signIn: string
    }
    sessionPrefix: string
  }
  header: {
    modeStudio: string
    modeSimple: string
    logoAriaHome: string
    workspaceLoading: string
    workspaceFallback: string
    demoBanner: string
    demoBannerLogin: string
    demoBannerTail: string
  }
  landing: {
    hero: {
      eyebrow: string
      titleHead: string
      titleTail: string
      rotatingWords: readonly string[]
      subtitle: string
      ctaPrimary: string
      ctaGhost: string
      footnote: string
    }
    composer: {
      title: string
      tag: string
      placeholder: string
      rate: string
      submit: string
      submitting: string
      errorShort: string
      errorNetwork: string
      taskAria: string
      actions: { copy: string; openStudio: string; regen: string }
      arrowLabel: string
    }
    ticker: {
      stack: string
      tierFast: string
      tierMid: string
      tierAdvanced: string
      uptime: string
      maxOut: string
      health: string
      vision: string
      stackValue: string
      uptimeValue: string
      maxOutValue: string
      healthValue: string
      visionValue: string
    }
    how: {
      num: string
      title: string
      lede: string
      cards: ReadonlyArray<{ num: string; title: string; body: string }>
    }
    forWho: {
      num: string
      title: string
      beginner: { badge: string; title: string; points: readonly string[] }
      engineer: { badge: string; title: string; points: readonly string[] }
    }
    trust: {
      num: string
      title: string
      lede: string
      modes: { text: string; vision: string }
      tiers: { auto: string; fast: string; mid: string; advanced: string }
      footnote: string
    }
    faq: {
      num: string
      title: string
      rows: ReadonlyArray<{ q: string; a: string }>
    }
    footer: {
      brand: string
      loginLink: string
      githubLink: string
      howLink: string
    }
  }
  auth: {
    brand: {
      title: string
      subtitle: string
      features: { library: string; analytics: string; history: string }
    }
    login: { title: string; caption: string; submit: string; tab: string }
    register: { title: string; caption: string; submit: string; tab: string }
    placeholder: {
      username: string
      email: string
      password: string
      password2: string
    }
    submitting: string
    divider: string
    github: { login: string; register: string }
    demo: string
    demoBanner: string
    demoBannerLogin: string
    demoBannerTail: string
    errors: {
      passwordMismatch: string
      emailRequired: string
      generic: string
      github: string
      githubDisabled: string
    }
  }
  library: {
    views: {
      label: string
      all: string
      recent: string
      best: string
      stale: string
      untagged: string
    }
    starters: {
      eyebrow: string
      title: string
      lede: string
      add: string
      adding: string
      added: string
      failed: string
      goalTag: { work: string; study: string; own: string }
    }
    searchPlaceholder: string
  }
  notFound: { title: string; body: string; cta: string }
  privateOnly: { title: string; body: string; tryDemo: string }
  onboarding: {
    progress: string
    skip: string
    back: string
    next: string
    step1: {
      eyebrow: string
      title: string
      lede: string
      goals: ReadonlyArray<{ id: string; label: string; hint: string }>
    }
    step2: {
      eyebrow: string
      title: string
      lede: string
      tiers: ReadonlyArray<{ id: string; label: string; body: string }>
    }
    step3: {
      eyebrow: string
      title: string
      lede: string
      placeholder: string
      submit: string
      submitting: string
      errorShort: string
      errorNetwork: string
      resultTitle: string
      actions: { openStudio: string; again: string }
      suggestionsTitle: string
      suggestionsByGoal: Record<string, readonly string[]>
    }
    done: {
      title: string
      body: string
      cta: string
    }
  }
} = {
  lang: {
    name: 'RU',
    full: 'Русский',
  },
  common: {
    login: 'Войти',
    loading: 'Загрузка…',
    back: 'Назад',
    next: 'Далее',
    skip: 'Пропустить',
    done: 'Готово',
    cancel: 'Отмена',
    retry: 'Повторить',
    copy: 'Копировать',
    languageSwitch: 'Язык интерфейса',
  },

  palette: {
    open: 'Команды',
    hint: '⌘K',
    placeholder: 'Поиск команд и сессий…',
    empty: 'Ничего не нашли',
    groups: {
      navigate: 'Перейти',
      actions: 'Действия',
      recent: 'Недавние сессии',
      admin: 'Админ',
    },
    cmd: {
      goStudio: 'Открыть Studio',
      goSimple: 'Открыть «Улучшить»',
      goCompare: 'Открыть A/B Compare',
      goLibrary: 'Открыть библиотеку',
      goCommunity: 'Открыть Community',
      goModels: 'Открыть «Модели»',
      goWorkspaces: 'Пространства',
      goPresets: 'Пресеты',
      goSettings: 'Настройки',
      goUserInfo: 'Мой профиль и метрики',
      goHelp: 'Справка',
      goAdmin: 'Админ-панель',
      themeLight: 'Сменить тему: светлая',
      themeDark: 'Сменить тему: тёмная',
      langRu: 'Язык: Русский',
      langEn: 'Language: English',
      signOut: 'Выйти',
      signIn: 'Войти',
    },
    sessionPrefix: 'Открыть сессию: ',
  },

  header: {
    modeStudio: 'Студия',
    modeSimple: 'Улучшить',
    logoAriaHome: 'На главную',
    workspaceLoading: 'Загрузка…',
    workspaceFallback: 'Пространство #{id}',
    demoBanner: 'Демо без входа: запросы к серверу недоступны.',
    demoBannerLogin: 'Войти',
    demoBannerTail: ', чтобы работать с данными.',
  },

  landing: {
    hero: {
      eyebrow: 'STUDIO · v0.9',
      titleHead: 'От общей задачи — к промпту, который ',
      titleTail: '.',
      rotatingWords: ['работает', 'понимает', 'держит', 'повторяется', 'проверяется'],
      subtitle:
        'Одно предложение на входе — структурированный промпт на выходе. Можно пощупать прямо здесь, без входа.',
      ctaPrimary: 'Открыть Studio →',
      ctaGhost: 'Что умеет',
      footnote: 'Без ключей. Без регистрации. Без обещаний.',
    },
    composer: {
      title: 'Живое демо',
      tag: 'DEMO',
      placeholder:
        'Напиши промпт для описания товара в интернет-магазине — лаконично, без рекламного тона.',
      rate: '5 / 5 мин',
      submit: 'Сгенерировать',
      submitting: 'Генерирую',
      errorShort: 'Опишите задачу хотя бы одним предложением.',
      errorNetwork: 'Демо временно недоступно.',
      taskAria: 'Задача для демо',
      actions: {
        copy: 'Копировать',
        openStudio: 'Открыть в Studio',
        regen: 'Ещё вариант',
      },
      arrowLabel: 'live · no login',
    },
    ticker: {
      stack: 'стек',
      tierFast: 'tier=fast',
      tierMid: 'tier=mid',
      tierAdvanced: 'tier=advanced',
      uptime: 'uptime',
      maxOut: 'max out',
      health: 'health',
      vision: 'vision',
      stackValue: 'auto · mid · advanced',
      uptimeValue: '30д · 99.2%',
      maxOutValue: '≤ $3 / 1M токенов',
      healthValue: '6/6 зелёных',
      visionValue: 'degraded · fallback ok',
    },
    how: {
      num: '01',
      title: 'Что это вообще',
      lede: 'Три вещи, которые продукт делает лучше, чем голый чат.',
      cards: [
        {
          num: '01',
          title: 'Compose',
          body: 'Задача на одной строке → собранный промпт с ролью, контекстом, ограничениями и форматом вывода. Руками править можно, а часто — не нужно.',
        },
        {
          num: '02',
          title: 'Compare',
          body: 'A/B две версии на одной задаче. Техники, модели или промпты целиком — как удобно. Судья разбирает по критериям, а не «мне больше нравится A».',
        },
        {
          num: '03',
          title: 'Keep',
          body: 'Библиотека с тегами, версиями, диффами и smart-группами. Рабочие промпты — рядом со студией, а не в закладках.',
        },
      ],
    },
    forWho: {
      num: '02',
      title: 'Для кого',
      beginner: {
        badge: 'Новичку',
        title: 'Если LLM есть, а системы нет',
        points: [
          'Не нужно знать слова «few-shot» и «chain-of-thought».',
          'Стартовые шаблоны и примеры в композере.',
          'Перевод RU ⇄ EN в один клик, без LLM.',
        ],
      },
      engineer: {
        badge: 'Инженеру',
        title: 'Если промпты — часть работы',
        points: [
          'Auto / Fast / Mid / Advanced вместо ручного выбора моделей.',
          'Запуск A/B на целевой модели, diff, разбор по критериям.',
          'Свой ключ OpenRouter снимает все лимиты хоста.',
        ],
      },
    },
    trust: {
      num: '03',
      title: 'Модели под капотом',
      lede: 'Проверяем ежедневно. Если что-то упало — подставляем эквивалент из той же ценовой корзины.',
      modes: { text: 'Текст', vision: 'Зрение' },
      tiers: { auto: 'Auto', fast: 'Fast', mid: 'Mid', advanced: 'Advanced' },
      footnote: 'Снимок последнего healthcheck · TTL 5 мин · подробнее в /admin/model-health',
    },
    faq: {
      num: '04',
      title: 'Часто спрашивают',
      rows: [
        {
          q: 'Зачем мне свой OpenRouter-ключ?',
          a: 'С ключом платишь напрямую провайдеру и выбираешь любые модели. Без ключа работает пробный режим с лимитами хоста — его хватает, чтобы распробовать.',
        },
        {
          q: 'Что за пробный режим и какие лимиты?',
          a: 'Набор токенов после регистрации плюс 10 генераций в 5 минут и дневной бюджет A/B-сравнений. Точные числа в профиле.',
        },
        {
          q: 'Что вы сохраняете?',
          a: 'Демо на этой странице — ничего. После входа: библиотека, история сессий, настройки. Текст задач в LLM мы провайдерам не пересылаем сверх того, что нужно для ответа.',
        },
        {
          q: 'Auto / Fast / Mid / Advanced — это что?',
          a: 'Уровни задач, не конкретные модели. Auto подбирает сам, Fast — быстро и дёшево, Mid — баланс, Advanced — сложные кейсы с рассуждениями. Модели под капотом могут меняться — мы следим, чтобы не ломалась воспроизводимость.',
        },
        {
          q: 'Можно без регистрации?',
          a: 'Демо-виджет наверху — да. Для Studio, библиотеки и A/B нужен аккаунт. Бесплатный.',
        },
        {
          q: 'Как считаете completeness?',
          a: 'Эвристикой по структуре текста: роли, ограничения, формат вывода, примеры. Это быстрый фильтр, не замена LLM-судьи.',
        },
      ],
    },
    footer: {
      brand: 'MetaPrompt · 2026',
      loginLink: 'Войти',
      githubLink: 'GitHub',
      howLink: 'Как работает',
    },
  },

  auth: {
    brand: {
      title: 'MetaPrompt',
      subtitle:
        'Оптимизируй промпты с помощью AI. Создавай, тестируй и улучшай свои промпты в одном месте.',
      features: {
        library: 'Библиотека промптов',
        analytics: 'Аналитика и метрики',
        history: 'История версий',
      },
    },
    login: {
      title: 'Добро пожаловать',
      caption: 'Войдите, чтобы продолжить работу',
      submit: 'Войти',
      tab: 'Вход',
    },
    register: {
      title: 'Создать аккаунт',
      caption: 'Зарегистрируйтесь для начала работы',
      submit: 'Создать аккаунт',
      tab: 'Регистрация',
    },
    placeholder: {
      username: 'Имя пользователя',
      email: 'Email',
      password: 'Пароль',
      password2: 'Повторите пароль',
    },
    submitting: 'Подождите...',
    divider: 'или',
    github: {
      login: 'Войти через GitHub',
      register: 'Зарегистрироваться через GitHub',
    },
    demo: 'Войти как гость (Demo)',
    demoBanner:
      'Демо без входа: запросы к серверу недоступны.',
    demoBannerLogin: 'Войти',
    demoBannerTail: ', чтобы работать с данными.',
    errors: {
      passwordMismatch: 'Пароли не совпадают',
      emailRequired: 'Укажите email',
      generic: 'Ошибка авторизации',
      github: 'Не удалось войти через GitHub. Попробуйте ещё раз.',
      githubDisabled: 'Аккаунт отключён. Обратитесь к администратору.',
    },
  },

  library: {
    views: {
      label: 'Подборки',
      all: 'Все',
      recent: 'Недавние',
      best: 'Топ по оценке',
      stale: 'Давно не трогали',
      untagged: 'Без тегов',
    },
    starters: {
      eyebrow: 'С чего начать',
      title: 'Ваша библиотека пока пуста',
      lede: 'Добавьте один из стартовых шаблонов — его можно будет отредактировать как обычный промпт.',
      add: 'Добавить',
      adding: 'Добавляю…',
      added: 'Добавлено',
      failed: 'Не получилось',
      goalTag: { work: 'для работы', study: 'для учёбы', own: 'для своих проектов' },
    },
    searchPlaceholder: 'Поиск по тексту и тегам…',
  },

  notFound: {
    title: 'Страница не найдена',
    body: 'Ссылка устарела или ведёт в частную часть продукта.',
    cta: 'На главную',
  },

  privateOnly: {
    title: 'Требуется вход',
    body: 'Войдите в аккаунт, чтобы открыть этот раздел.',
    tryDemo: 'Попробовать без регистрации',
  },

  onboarding: {
    progress: 'Шаг {current} из {total}',
    skip: 'Пропустить',
    back: 'Назад',
    next: 'Далее',
    step1: {
      eyebrow: '01 · ЗАЧЕМ',
      title: 'Для чего вам промпты?',
      lede: 'Выберите одно — это повлияет на стартовые подсказки. Потом можно поменять.',
      goals: [
        {
          id: 'work',
          label: 'Работа',
          hint: 'Документы, письма, код, маркетинг, аналитика.',
        },
        {
          id: 'study',
          label: 'Учёба',
          hint: 'Резюме материала, план, проверка аргументов.',
        },
        {
          id: 'own',
          label: 'Своё дело',
          hint: 'Контент, идеи, сценарии, эксперименты.',
        },
      ],
    },
    step2: {
      eyebrow: '02 · КАК',
      title: 'С какой сложностью обычно работаете?',
      lede: 'Выберите тир по умолчанию. Его можно менять в каждом запросе.',
      tiers: [
        {
          id: 'auto',
          label: 'Auto',
          body: 'Продукт сам выберет модель под задачу. Лучший старт.',
        },
        {
          id: 'fast',
          label: 'Fast',
          body: 'Короткие задачи, шаблоны, быстрые итерации.',
        },
        {
          id: 'mid',
          label: 'Mid',
          body: 'Баланс. Большинство рабочих задач.',
        },
        {
          id: 'advanced',
          label: 'Advanced',
          body: 'Длинные рассуждения, сложный контекст.',
        },
      ],
    },
    step3: {
      eyebrow: '03 · ПРОБА',
      title: 'Соберите свой первый промпт',
      lede: 'Опишите задачу одной-двумя фразами. Продукт превратит её в структурированный промпт и сохранит в сессиях.',
      placeholder: 'Напишите текст для поста в блог компании про запуск нового продукта.',
      submit: 'Собрать промпт',
      submitting: 'Собираю',
      errorShort: 'Опишите задачу хотя бы одним предложением.',
      errorNetwork: 'Не получилось сгенерировать. Попробуйте ещё раз.',
      resultTitle: 'Готово — это ваш первый промпт',
      actions: {
        openStudio: 'Открыть в Studio →',
        again: 'Попробовать на другой задаче',
      },
      suggestionsTitle: 'Идеи:',
      suggestionsByGoal: {
        work: [
          'Напиши черновик письма клиенту с задержкой по проекту.',
          'Собери release notes по этим коммитам: …',
          'Сверстай KPI-дашборд на неделю по вот этим метрикам.',
        ],
        study: [
          'Сделай план подготовки к экзамену по линейной алгебре на 2 недели.',
          'Сравни две статьи по одинаковой методологии.',
          'Сведи этот текст к 10 тезисам с разбивкой по темам.',
        ],
        own: [
          'Придумай tagline и 3 подзаголовка для продукта про …',
          'Сформулируй оффер для лендинга курса по …',
          'Сгенерируй 5 идей тем для телеграм-канала.',
        ],
      },
    },
    done: {
      title: 'Всё, вы в Studio',
      body: 'Первая сессия сохранена — она уже есть в списке слева.',
      cta: 'Перейти в Studio',
    },
  },
}

export type Dict = typeof ru
export default ru
