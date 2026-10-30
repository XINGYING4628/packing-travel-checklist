(() => {
  "use strict";

  const STORAGE_KEY = "shoushi-go-store-v1";
  const APP_VERSION = 1;
  const BUILD_VERSION = "202610301640";
  const JOURNAL_DB_NAME = "shoushi-go-journal-media";
  const JOURNAL_DB_VERSION = 1;
  const JOURNAL_MEDIA_STORE = "photos";
  const JOURNAL_MAX_PHOTOS = 9;
  const templateStyles = {
    essential: { color: "#f8e9b9", icon: "i-lock" },
    short: { color: "#d9e6d8", icon: "i-suitcase" },
    long: { color: "#f9e0cf", icon: "i-sun" },
    business: { color: "#dbe7f0", icon: "i-edit" },
    residence: { color: "#eadfda", icon: "i-home" }
  };
  const avatarClasses = ["avatar-coral", "avatar-yellow", "avatar-mint", "avatar-sky", "avatar-plum"];
  const categoryPalette = ["#f8e9b9", "#d9e6d8", "#f9e0cf", "#dbe7f0", "#eadfda"];
  const dayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const themes = {
    cream: {
      name: "奶油暖阳",
      description: "温暖、轻盈的默认主题",
      metaColor: "#f7f4ed",
      preview: { background: "#f7f4ed", paper: "#fffdf8", accent: "#ec9569", ink: "#29386f", soft: "#f3c55f" }
    },
    ocean: {
      name: "海盐微风",
      description: "清透蓝调与柔和海盐色",
      metaColor: "#edf5f7",
      preview: { background: "#edf5f7", paper: "#fbfefe", accent: "#de8a76", ink: "#294b5c", soft: "#9ecbd0" }
    },
    forest: {
      name: "林间晨雾",
      description: "安静自然的森林绿意",
      metaColor: "#edf2e9",
      preview: { background: "#edf2e9", paper: "#fcfdf8", accent: "#c6815d", ink: "#354d3e", soft: "#a9bf9d" }
    },
    sakura: {
      name: "樱花日暮",
      description: "柔粉背景与暮色酒红",
      metaColor: "#faeff0",
      preview: { background: "#faeff0", paper: "#fffafa", accent: "#d8899c", ink: "#5b3f4f", soft: "#e7b7c1" }
    }
  };

  let store = loadStore();
  let currentTripId = null;
  let currentTemplateId = null;
  let tripFilter = "active";
  let tripSearch = "";
  let templateSearch = "";
  let collapsedCategories = new Set();
  let onlyUnpacked = false;
  let lastFocusedElement = null;
  let modalSubmitHandler = null;
  let pendingImport = null;
  let pendingImportMedia = {};
  let pendingJournalImages = [];
  let journalDraftText = "";
  let journalDraftTripId = null;
  let journalDbPromise = null;
  let tripDetailTab = "checklist";

  const dom = {
    main: document.getElementById("mainContent"),
    backdrop: document.getElementById("modalBackdrop"),
    modal: document.getElementById("appModal"),
    modalContent: document.getElementById("modalContent"),
    toastStack: document.getElementById("toastStack"),
    importFile: document.getElementById("importFile"),
    journalPhotoInput: document.getElementById("journalPhotoInput"),
    offlineBanner: document.getElementById("offlineBanner")
  };

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function dateInputValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dateTimeInputValue(date) {
    return `${dateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function addDays(base, days) {
    const copy = new Date(base);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function parseLocalDate(value) {
    if (!value) return null;
    const parts = value.slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function daysUntil(value) {
    const target = parseLocalDate(value);
    if (!target) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function monthDay(value) {
    const date = parseLocalDate(value);
    if (!date) return "待定";
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatDateRange(start, end) {
    if (!start) return "日期待定";
    if (!end || start === end) return monthDay(start);
    return `${monthDay(start)} - ${monthDay(end)}`;
  }

  function formatDateTime(value) {
    if (!value) return "未设置";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未设置";
    return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatShortTime(value) {
    if (!value) return "刚刚";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚";
    const diff = Math.max(0, Date.now() - date.getTime());
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#${name}"></use></svg>`;
  }

  function openJournalDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("当前浏览器不支持本地照片存储"));
    if (journalDbPromise) return journalDbPromise;
    journalDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(JOURNAL_DB_NAME, JOURNAL_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(JOURNAL_MEDIA_STORE)) {
          db.createObjectStore(JOURNAL_MEDIA_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开照片存储"));
      request.onblocked = () => reject(new Error("照片存储正在被其他页面占用"));
    });
    return journalDbPromise;
  }

  async function journalMediaRequest(mode, operation) {
    const db = await openJournalDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(JOURNAL_MEDIA_STORE, mode);
      const store = transaction.objectStore(JOURNAL_MEDIA_STORE);
      const request = operation(store);
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error || request?.error || new Error("照片存储失败"));
      transaction.onabort = () => reject(transaction.error || new Error("照片存储已中断"));
    });
  }

  function putJournalImage(imageId, dataUrl) {
    return journalMediaRequest("readwrite", (store) => store.put(dataUrl, imageId));
  }

  function getJournalImage(imageId) {
    return journalMediaRequest("readonly", (store) => store.get(imageId));
  }

  function deleteJournalImages(imageIds = []) {
    const ids = [...new Set(imageIds.filter(Boolean))];
    if (!ids.length) return Promise.resolve();
    return Promise.all(ids.map((imageId) => journalMediaRequest("readwrite", (store) => store.delete(imageId))));
  }

  function clearJournalImages() {
    return journalMediaRequest("readwrite", (store) => store.clear());
  }

  function getTripJournalImages(trips = []) {
    return trips.flatMap((trip) => (trip.journal || []).flatMap((entry) => (entry.images || []).map((image) => image.id))).filter(Boolean);
  }

  function formatJournalDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚";
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("这张照片的格式无法读取"));
      };
      image.src = objectUrl;
    });
  }

  async function prepareJournalImage(file) {
    if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");
    const image = await loadImageFile(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return {
      id: uid("journalphoto"),
      name: String(file.name || "旅途照片").slice(0, 80),
      dataUrl: canvas.toDataURL("image/jpeg", 0.8)
    };
  }

  function makeItem(name, quantity = 1, note = "", checked = false) {
    return { id: uid("item"), name, quantity, note, checked, order: 0 };
  }

  function makeCategory(name, emoji, items = [], index = 0) {
    return {
      id: uid("cat"),
      name,
      emoji,
      order: index,
      items: items.map((item, itemIndex) => ({
        id: uid("item"),
        name: item.name,
        quantity: item.quantity ?? 1,
        note: item.note ?? "",
        checked: Boolean(item.checked),
        order: itemIndex
      }))
    };
  }

  function makeTemplate(seed, index) {
    return {
      id: seed.id,
      name: seed.name,
      description: seed.description,
      icon: seed.icon,
      color: seed.color,
      isSystem: true,
      createdAt: new Date().toISOString(),
      order: index,
      categories: seed.categories.map((category, categoryIndex) => makeCategory(
        category.name,
        category.emoji,
        category.items,
        categoryIndex
      ))
    };
  }

  function getTemplateSeeds() {
    return [
      {
        id: "tpl_essential",
        name: "必备物品",
        description: "每次出门都用得上的基础清单",
        icon: "i-lock",
        color: "#f8e9b9",
        categories: [
          { name: "证件票卡", emoji: "🪪", items: [{ name: "身份证", checked: true }, { name: "银行卡与少量现金", checked: true }, { name: "钥匙" }] },
          { name: "随身物品", emoji: "🎒", items: [{ name: "手机", quantity: 1 }, { name: "纸巾" }, { name: "水杯" }, { name: "雨伞" }, { name: "充电宝" }] },
          { name: "常用药物", emoji: "💊", items: [{ name: "创可贴" }, { name: "个人常用药", note: "按需携带" }] }
        ]
      },
      {
        id: "tpl_short",
        name: "短期旅行",
        description: "1-3 天轻装出发，刚刚好",
        icon: "i-suitcase",
        color: "#d9e6d8",
        categories: [
          { name: "证件票卡", emoji: "🪪", items: [{ name: "身份证", checked: true }, { name: "银行卡与少量现金", checked: true }, { name: "酒店预订信息" }] },
          { name: "衣物鞋包", emoji: "👕", items: [{ name: "换洗上衣", quantity: 2 }, { name: "裤子", quantity: 2 }, { name: "内衣袜子", quantity: 3 }, { name: "睡衣" }, { name: "舒适鞋子" }] },
          { name: "洗护用品", emoji: "🧴", items: [{ name: "牙刷 / 牙膏", checked: true }, { name: "洗面奶" }, { name: "防晒霜" }, { name: "护肤品分装" }] },
          { name: "电子设备", emoji: "🔌", items: [{ name: "手机充电器", checked: true }, { name: "耳机", checked: true }, { name: "相机", note: "记得带电池" }, { name: "充电宝" }] },
          { name: "其他", emoji: "☂️", items: [{ name: "折叠伞" }, { name: "水杯" }, { name: "常用药" }, { name: "行李牌" }] }
        ]
      },
      {
        id: "tpl_long",
        name: "长期旅行",
        description: "一周以上，带全也带轻",
        icon: "i-sun",
        color: "#f9e0cf",
        categories: [
          { name: "重要证件", emoji: "🛂", items: [{ name: "身份证" }, { name: "护照 / 签证", note: "出国行程按需" }, { name: "机票与酒店凭证" }, { name: "旅行保险" }, { name: "证件复印件" }] },
          { name: "衣物鞋包", emoji: "🧥", items: [{ name: "换洗衣物", quantity: 7 }, { name: "外套" }, { name: "睡衣" }, { name: "内衣袜子", quantity: 7 }, { name: "备用鞋" }, { name: "收纳袋" }] },
          { name: "洗护用品", emoji: "🪥", items: [{ name: "牙刷牙膏" }, { name: "洗护旅行装" }, { name: "毛巾" }, { name: "防晒霜" }, { name: "护手霜" }] },
          { name: "电子设备", emoji: "📷", items: [{ name: "手机充电器" }, { name: "多口充电头" }, { name: "充电宝" }, { name: "耳机" }, { name: "相机与存储卡" }] },
          { name: "健康与常备", emoji: "💊", items: [{ name: "个人常用药" }, { name: "创可贴" }, { name: "肠胃药" }, { name: "口罩" }] }
        ]
      },
      {
        id: "tpl_business",
        name: "出差",
        description: "工作与体面，一样都不落",
        icon: "i-edit",
        color: "#dbe7f0",
        categories: [
          { name: "证件与行程", emoji: "🪪", items: [{ name: "身份证", checked: true }, { name: "名片" }, { name: "差旅审批单" }, { name: "酒店预订信息" }] },
          { name: "商务装备", emoji: "💻", items: [{ name: "笔记本电脑", checked: true }, { name: "电脑充电器", checked: true }, { name: "鼠标" }, { name: "激光笔" }, { name: "转接头" }] },
          { name: "正式着装", emoji: "👔", items: [{ name: "衬衫", quantity: 2 }, { name: "西装外套" }, { name: "商务鞋" }, { name: "腰带" }] },
          { name: "电子配件", emoji: "🔌", items: [{ name: "手机充电器" }, { name: "充电宝" }, { name: "耳机" }, { name: "U 盘 / 移动硬盘" }] },
          { name: "生活用品", emoji: "🧳", items: [{ name: "洗漱包" }, { name: "水杯" }, { name: "领带 / 丝巾" }, { name: "常用药" }] }
        ]
      },
      {
        id: "tpl_residence",
        name: "旅居",
        description: "像生活一样去远方",
        icon: "i-home",
        color: "#eadfda",
        categories: [
          { name: "证件财务", emoji: "🪪", items: [{ name: "身份证" }, { name: "银行卡" }, { name: "租房合同" }, { name: "保险资料" }] },
          { name: "日常衣物", emoji: "👕", items: [{ name: "当季衣物", quantity: 7 }, { name: "居家服" }, { name: "鞋", quantity: 2 }, { name: "帽子和配饰" }] },
          { name: "厨房小物", emoji: "🍳", items: [{ name: "便携餐具" }, { name: "保温杯" }, { name: "密封袋" }, { name: "小电锅", note: "按需" }] },
          { name: "生活用品", emoji: "🧺", items: [{ name: "洗漱包" }, { name: "速干毛巾" }, { name: "洗衣袋" }, { name: "折叠晾衣架" }, { name: "针线包" }] },
          { name: "健康与工作", emoji: "💊", items: [{ name: "常用药" }, { name: "体温计" }, { name: "笔记本电脑" }, { name: "充电器与数据线" }] }
        ]
      }
    ];
  }

  function createInitialStore() {
    const initialTemplates = getTemplateSeeds().map(makeTemplate);
    const now = new Date();
    const tripOne = createTripFromTemplate(initialTemplates[1], {
      name: "周末杭州",
      route: "上海 → 杭州",
      startDate: dateInputValue(addDays(now, 2)),
      endDate: dateInputValue(addDays(now, 4)),
      accent: "#d9e6d8"
    });
    tripOne.id = "trip_hangzhou";
    let checkedCounter = 0;
    tripOne.categories.forEach((category, categoryIndex) => {
      category.items.forEach((item, itemIndex) => {
        item.checked = (categoryIndex + itemIndex) % 3 === 0 && checkedCounter < 6;
        if (item.checked) checkedCounter += 1;
      });
    });

    const tripTwo = createTripFromTemplate(initialTemplates[2], {
      name: "大理慢生活",
      route: "杭州 → 大理",
      startDate: dateInputValue(addDays(now, 14)),
      endDate: dateInputValue(addDays(now, 20)),
      accent: "#f9e0cf"
    });
    tripTwo.id = "trip_dali";
    tripTwo.categories[0].items[0].checked = true;
    tripTwo.categories[3].items[0].checked = true;

    const tripThree = createTripFromTemplate(initialTemplates[3], {
      name: "上海设计周",
      route: "上海 → 上海",
      startDate: dateInputValue(addDays(now, -12)),
      endDate: dateInputValue(addDays(now, -10)),
      accent: "#dbe7f0"
    });
    tripThree.id = "trip_shanghai";
    tripThree.status = "archived";
    tripThree.categories.forEach((category) => category.items.forEach((item) => { item.checked = true; }));

    const reminderDate = addDays(now, 1);
    reminderDate.setHours(20, 0, 0, 0);
    tripOne.reminders = [{
      id: uid("reminder"),
      triggerAt: dateTimeInputValue(reminderDate),
      channels: ["inApp", "browser"],
      enabled: true,
      sent: false,
      createdAt: now.toISOString()
    }];

    const profile = {
      id: "profile_default",
      name: "小旅",
      avatarClass: "avatar-coral",
      createdAt: now.toISOString(),
      templates: initialTemplates,
      trips: [tripOne, tripTwo, tripThree],
      shares: [],
      settings: {
        browserNotify: false,
        inAppNotify: true,
        timezone: "Asia/Shanghai",
        theme: "cream"
      }
    };
    return {
      version: APP_VERSION,
      activeProfileId: profile.id,
      profiles: [profile],
      lastSavedAt: now.toISOString()
    };
  }

  function createTripFromTemplate(template, fields) {
    return {
      id: uid("trip"),
      name: fields.name,
      route: fields.route || "目的地待定",
      startDate: fields.startDate || "",
      endDate: fields.endDate || "",
      accent: fields.accent || template.color,
      templateId: template.id,
      templateName: template.name,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reminders: [],
      journal: [],
      categories: template.categories.map((category, categoryIndex) => ({
        id: uid("tripcat"),
        name: category.name,
        emoji: category.emoji,
        order: categoryIndex,
        items: category.items.map((item, itemIndex) => ({
          id: uid("tripitem"),
          name: item.name,
          quantity: item.quantity || 1,
          note: item.note || "",
          checked: Boolean(item.checked),
          order: itemIndex
        }))
      }))
    };
  }

  function normalizeStore(candidate) {
    if (!candidate || !Array.isArray(candidate.profiles) || !candidate.profiles.length) {
      throw new Error("备份文件结构不完整");
    }
    const profiles = candidate.profiles.map((profile, index) => {
      if (!profile || !Array.isArray(profile.templates) || !Array.isArray(profile.trips)) {
        throw new Error("资料档数据不完整");
      }
      return {
        id: profile.id || uid("profile"),
        name: String(profile.name || `旅人${index + 1}`).slice(0, 20),
        avatarClass: avatarClasses.includes(profile.avatarClass) ? profile.avatarClass : avatarClasses[index % avatarClasses.length],
        createdAt: profile.createdAt || new Date().toISOString(),
        templates: profile.templates,
        trips: profile.trips.map((trip) => ({
          ...trip,
          journal: Array.isArray(trip.journal) ? trip.journal.map((entry) => ({
            id: entry.id || uid("journal"),
            text: String(entry.text || "").slice(0, 1200),
            createdAt: entry.createdAt || new Date().toISOString(),
            images: Array.isArray(entry.images)
              ? entry.images.filter((image) => image?.id).map((image) => ({ id: image.id, name: String(image.name || "旅途照片").slice(0, 80) }))
              : []
          })) : []
        })),
        shares: Array.isArray(profile.shares) ? profile.shares : [],
        settings: {
          browserNotify: Boolean(profile.settings?.browserNotify),
          inAppNotify: profile.settings?.inAppNotify !== false,
          timezone: profile.settings?.timezone || "Asia/Shanghai",
          theme: themes[profile.settings?.theme] ? profile.settings.theme : "cream"
        }
      };
    });
    return {
      version: APP_VERSION,
      profiles,
      activeProfileId: profiles.some((profile) => profile.id === candidate.activeProfileId)
        ? candidate.activeProfileId
        : profiles[0].id,
      lastSavedAt: candidate.lastSavedAt || new Date().toISOString()
    };
  }

  function loadStore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeStore(JSON.parse(saved));
    } catch (error) {
      console.warn("读取本地数据失败", error);
    }
    return createInitialStore();
  }

  function currentProfile() {
    return store.profiles.find((profile) => profile.id === store.activeProfileId) || store.profiles[0];
  }

  function currentSettings() {
    const profile = currentProfile();
    if (!profile.settings) {
      profile.settings = { browserNotify: false, inAppNotify: true, timezone: "Asia/Shanghai", theme: "cream" };
    }
    if (!themes[profile.settings.theme]) profile.settings.theme = "cream";
    return profile.settings;
  }

  function applyTheme(themeId) {
    const selectedTheme = themes[themeId] ? themeId : "cream";
    document.documentElement.dataset.theme = selectedTheme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", themes[selectedTheme].metaColor);
  }

  function setTheme(themeId) {
    if (!themes[themeId]) return;
    currentSettings().theme = themeId;
    applyTheme(themeId);
    saveStore({ quiet: true });
    renderSettings();
    showToast(`已切换为「${themes[themeId].name}」`);
  }

  function saveStore({ quiet = false } = {}) {
    store.lastSavedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      const status = document.getElementById("syncStatus");
      const time = document.getElementById("syncTime");
      if (status) status.textContent = navigator.onLine ? "所有更改已保存" : "已保存到本机";
      if (time) time.textContent = "刚刚";
      if (!quiet && !navigator.onLine) {
        // Offline saves are intentionally quiet; the fixed banner keeps the state visible.
      }
    } catch (error) {
      console.error("保存失败", error);
      showToast("自动保存失败，请导出备份", true);
    }
  }

  function getActiveTrips() {
    return currentProfile().trips
      .filter((trip) => trip.status === "active")
      .sort((a, b) => {
        const dateA = a.startDate || "9999-12-31";
        const dateB = b.startDate || "9999-12-31";
        return dateA.localeCompare(dateB);
      });
  }

  function getTripProgress(trip) {
    const items = trip.categories.flatMap((category) => category.items);
    const total = items.length;
    const checked = items.filter((item) => item.checked).length;
    return { total, checked, remaining: total - checked, percent: total ? Math.round((checked / total) * 100) : 0 };
  }

  function getCategoryProgress(category) {
    const total = category.items.length;
    const checked = category.items.filter((item) => item.checked).length;
    return { total, checked, percent: total ? Math.round((checked / total) * 100) : 0 };
  }

  function getTemplateItemCount(template) {
    return template.categories.reduce((sum, category) => sum + category.items.length, 0);
  }

  function renderAll() {
    applyTheme(currentSettings().theme);
    renderHeader();
    renderDashboard();
    renderTrips();
    renderTemplates();
    renderSettings();
    updateNavCount();
    if (currentTripId && document.getElementById("view-tripDetail").classList.contains("is-active")) {
      renderTripDetail();
    }
    if (currentTemplateId && document.getElementById("view-templateDetail").classList.contains("is-active")) {
      renderTemplateDetail();
    }
  }

  function renderHeader() {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
    const profile = currentProfile();
    document.getElementById("greetingTitle").innerHTML = `${greeting}，${escapeHtml(profile.name)} <span class="heading-sun">${hour >= 18 ? "☾" : "☀"}</span>`;
    document.getElementById("todayEyebrow").textContent = `${dayNames[now.getDay()]} · ${now.getMonth() + 1}月${now.getDate()}日`;
    document.getElementById("dateDay").textContent = pad(now.getDate());
    document.getElementById("dateMonth").textContent = monthNames[now.getMonth()];
    document.getElementById("dateWeek").textContent = dayNames[now.getDay()];

    document.querySelectorAll("[data-user-name]").forEach((element) => { element.textContent = profile.name; });
    document.querySelectorAll("[data-avatar]").forEach((element) => {
      element.textContent = profile.name.slice(0, 1);
      element.classList.remove(...avatarClasses);
      element.classList.add(profile.avatarClass);
    });

    const miniAvatar = document.querySelector("#profileMini .avatar");
    const mobileAvatar = document.querySelector(".mobile-avatar");
    if (miniAvatar) {
      miniAvatar.className = `avatar ${profile.avatarClass}`;
    }
    if (mobileAvatar) {
      mobileAvatar.className = `mobile-avatar avatar ${profile.avatarClass}`;
    }
  }

  function renderDashboard() {
    const trips = getActiveTrips();
    const featured = trips[0] || currentProfile().trips.find((trip) => trip.status === "active");
    if (featured) {
      const progress = getTripProgress(featured);
      document.getElementById("heroTitle").textContent = featured.name;
      document.getElementById("heroRoute").innerHTML = `${escapeHtml(featured.route.split("→")[0]?.trim() || "上海")} <span>→</span> ${escapeHtml(featured.route.split("→")[1]?.trim() || "远方")}`;
      document.getElementById("heroDate").textContent = formatDateRange(featured.startDate, featured.endDate);
      const remainingDays = daysUntil(featured.startDate);
      document.getElementById("heroCountdown").textContent = remainingDays === null ? "日期待定" : remainingDays > 0 ? `还有 ${remainingDays} 天` : remainingDays === 0 ? "就是今天" : "享受旅程";
      document.getElementById("heroPercent").textContent = `${progress.percent}%`;
      document.getElementById("heroChecked").textContent = `${progress.checked} / ${progress.total}`;
      document.getElementById("heroRing").style.setProperty("--progress", progress.percent);
      document.getElementById("continueTrip").dataset.tripId = featured.id;
      document.getElementById("continueTrip").innerHTML = `${progress.checked ? "继续收拾" : "开始收拾"} ${icon("i-chevron-right")}`;
      const shareButton = document.querySelector('[data-action="share-current"]');
      if (shareButton) shareButton.dataset.tripId = featured.id;
    } else {
      document.getElementById("heroTitle").textContent = "下一站，等你命名";
      document.getElementById("heroRoute").innerHTML = `准备 <span>→</span> 出发`;
      document.getElementById("heroDate").textContent = "挑一个模板开始吧";
      document.getElementById("heroCountdown").textContent = "随时可以出发";
      document.getElementById("continueTrip").innerHTML = `新建行程 ${icon("i-chevron-right")}`;
      document.getElementById("continueTrip").dataset.action = "new-trip";
      document.getElementById("heroPercent").textContent = "0%";
      document.getElementById("heroChecked").textContent = "0 / 0";
      document.getElementById("heroRing").style.setProperty("--progress", 0);
    }
    if (!featured) document.getElementById("continueTrip").removeAttribute("data-trip-id");

    const recentTrips = getActiveTrips().slice(0, 2);
    const container = document.getElementById("dashboardTrips");
    container.innerHTML = recentTrips.map((trip) => {
      const progress = getTripProgress(trip);
      const start = parseLocalDate(trip.startDate);
      return `
        <article class="trip-card" data-open-trip="${trip.id}" style="--card-accent:${safeColor(trip.accent)}" tabindex="0" role="button" aria-label="打开${escapeHtml(trip.name)}">
          <div class="trip-card-top">
            <span class="trip-card-date"><strong>${start ? pad(start.getDate()) : "--"}</strong>${start ? `${start.getMonth() + 1} 月` : "待定"}</span>
            <span class="trip-card-status">${progress.percent === 100 ? "已收齐" : progress.percent === 0 ? "待收拾" : "收拾中"}</span>
          </div>
          <div>
            <h3>${escapeHtml(trip.name)}</h3>
            <span class="trip-card-route">${icon("i-pin")}${escapeHtml(trip.route)}</span>
          </div>
          <div class="trip-card-bottom">
            <div class="linear-progress"><span style="width:${progress.percent}%"></span></div>
            <strong>${progress.percent}%</strong>
          </div>
        </article>
      `;
    }).join("") || `
      <button class="trip-card" type="button" data-action="new-trip" style="align-items:center;justify-content:center;text-align:center">
        <span class="round-icon round-icon-coral">${icon("i-plus")}</span>
        <h3>开始规划下一站</h3>
        <span class="trip-card-route">从模板快速新建</span>
      </button>
    `;

    const templateContainer = document.getElementById("dashboardTemplates");
    templateContainer.innerHTML = currentProfile().templates.slice(0, 5).map((template) => `
      <button class="mini-template" type="button" data-open-template="${template.id}" style="--template-bg:${safeColor(template.color)}">
        <span class="mini-template-icon">${icon(template.icon || "i-grid")}</span>
        <strong>${escapeHtml(template.name)}</strong>
        <span>${template.categories.length} 个分类 · ${getTemplateItemCount(template)} 件</span>
      </button>
    `).join("");

    renderNextReminder();
  }

  function renderNextReminder() {
    const upcoming = getUpcomingReminder();
    const container = document.getElementById("nextReminder");
    if (!container) return;
    if (upcoming) {
      const diff = daysUntil(upcoming.triggerAt);
      const dayLabel = diff === 0 ? "今天" : diff === 1 ? "明天" : `${diff} 天后`;
      container.innerHTML = `
        <p class="reminder-label">下一次提醒 · ${escapeHtml(upcoming.tripName)}</p>
        <strong class="reminder-time">${dayLabel} ${formatDateTime(upcoming.triggerAt).split(" ").pop()}</strong>
        <p class="reminder-desc">清点未带的物品，今晚就可以从容入睡。</p>
      `;
    } else {
      container.innerHTML = `
        <p class="reminder-label">还没有设置提醒</p>
        <strong class="reminder-time">出发前提醒一下</strong>
        <p class="reminder-desc">设置时间后，会显示行程和未带物品。</p>
      `;
    }
  }

  function getUpcomingReminder() {
    const reminders = getActiveTrips().flatMap((trip) => (trip.reminders || []).map((reminder) => ({
      ...reminder,
      tripName: trip.name,
      tripId: trip.id
    })));
    return reminders
      .filter((reminder) => reminder.enabled !== false && new Date(reminder.triggerAt).getTime() >= Date.now() - 60000)
      .sort((a, b) => new Date(a.triggerAt) - new Date(b.triggerAt))[0] || null;
  }

  function renderTrips() {
    const profile = currentProfile();
    let trips = [...profile.trips];
    if (tripFilter !== "all") trips = trips.filter((trip) => trip.status === tripFilter);
    if (tripSearch.trim()) {
      const query = tripSearch.trim().toLowerCase();
      trips = trips.filter((trip) => `${trip.name} ${trip.route}`.toLowerCase().includes(query));
    }
    trips.sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return (b.startDate || "").localeCompare(a.startDate || "");
    });
    const list = document.getElementById("tripList");
    const empty = document.getElementById("tripEmpty");
    document.querySelectorAll("[data-trip-filter]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tripFilter === tripFilter);
    });
    list.innerHTML = trips.map((trip) => {
      const progress = getTripProgress(trip);
      const start = parseLocalDate(trip.startDate);
      return `
        <article class="trip-list-row" data-open-trip="${trip.id}" tabindex="0" role="button" aria-label="打开${escapeHtml(trip.name)}">
          <div class="trip-list-thumb" style="--thumb-color:${safeColor(trip.accent)}">
            <strong>${start ? pad(start.getDate()) : "--"}</strong>
            <span>${start ? `${start.getMonth() + 1} 月` : "待定"}</span>
          </div>
          <div class="trip-list-info">
            <h3>${escapeHtml(trip.name)}</h3>
            <p><span>${icon("i-pin")}${escapeHtml(trip.route)}</span><span>${icon("i-calendar")}${formatDateRange(trip.startDate, trip.endDate)}</span></p>
          </div>
          <div class="trip-list-progress">
            <div class="linear-progress"><span style="width:${progress.percent}%"></span></div>
            <span>${progress.checked}/${progress.total}</span>
          </div>
          <span class="trip-list-status ${trip.status === "archived" ? "archived" : ""}">${trip.status === "archived" ? "已归档" : progress.percent === 100 ? "已收齐" : "收拾中"}</span>
          <span class="trip-row-arrow">${icon("i-chevron-right")}</span>
        </article>
      `;
    }).join("");
    empty.hidden = trips.length > 0;
    list.hidden = trips.length === 0;
  }

  function renderTemplates() {
    const templates = currentProfile().templates.filter((template) => {
      if (!templateSearch.trim()) return true;
      const haystack = [template.name, template.description, ...template.categories.flatMap((category) => [category.name, ...category.items.map((item) => item.name)])].join(" ").toLowerCase();
      return haystack.includes(templateSearch.trim().toLowerCase());
    });
    document.getElementById("templateGrid").innerHTML = templates.map((template) => `
      <article class="template-card" data-open-template="${template.id}" tabindex="0" role="button" aria-label="查看${escapeHtml(template.name)}模板">
        <span class="template-card-art" style="--template-bg:${safeColor(template.color)}"></span>
        <div class="template-icon-large" style="--template-bg:${safeColor(template.color)}">${icon(template.icon || "i-grid")}</div>
        <h3>${escapeHtml(template.name)}</h3>
        <p>${escapeHtml(template.description || "我的自定义清单模板")}</p>
        <div class="template-chip-row">
          ${template.categories.slice(0, 3).map((category) => `<span class="template-chip">${escapeHtml(category.name)}</span>`).join("")}
          ${template.categories.length > 3 ? `<span class="template-chip">+${template.categories.length - 3}</span>` : ""}
        </div>
        <div class="template-card-footer">
          <span>${getTemplateItemCount(template)} 件物品 · ${template.isSystem ? "系统模板" : "自建模板"}</span>
          <span class="mini-arrow">${icon("i-chevron-right")}</span>
        </div>
      </article>
    `).join("") || `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="empty-icon">${icon("i-search")}</span>
        <h3>没有找到相关模板</h3>
        <p>试试搜索其他名称或物品。</p>
      </div>
    `;
  }

  function renderTripDetail() {
    const trip = currentProfile().trips.find((item) => item.id === currentTripId);
    const container = document.getElementById("tripDetailContent");
    if (!trip) {
      showView("trips");
      return;
    }
    const progress = getTripProgress(trip);
    const visibleTotal = trip.categories.reduce((sum, category) => sum + category.items.filter((item) => !onlyUnpacked || !item.checked).length, 0);
    container.innerHTML = `
      <section class="trip-detail-header">
        <div class="trip-detail-lead" style="background:linear-gradient(125deg,var(--detail-start),${safeColor(trip.accent)})">
          <div class="detail-kicker">${icon(trip.status === "archived" ? "i-archive" : "i-suitcase")}<span>${trip.status === "archived" ? "已归档的旅程" : "旅程详情"}</span></div>
          <h1>${escapeHtml(trip.name)}</h1>
          <div class="detail-route">${icon("i-pin")}<span>${escapeHtml(trip.route)}</span></div>
          <div class="detail-date-row">
            <span>${icon("i-calendar")}${formatDateRange(trip.startDate, trip.endDate)}</span>
            <span>${icon("i-bell")}${(trip.reminders || []).length ? `${trip.reminders.length} 条提醒` : "暂无提醒"}</span>
          </div>
        </div>
        <div class="detail-progress-panel">
          <div class="large-ring" style="--progress:${progress.percent}"><div><strong>${progress.percent}%</strong><span>完成进度</span></div></div>
          <p><strong>${progress.checked} / ${progress.total}</strong> 件已带齐<br>${progress.remaining ? `还有 ${progress.remaining} 件待确认` : "全部收齐，可以出发啦"}</p>
        </div>
      </section>

      <nav class="trip-detail-tabs" role="tablist" aria-label="行程内容切换">
        <button class="trip-detail-tab ${tripDetailTab === "checklist" ? "is-active" : ""}" type="button" role="tab" data-action="set-trip-tab" data-trip-tab="checklist" aria-selected="${tripDetailTab === "checklist"}">
          <span class="trip-tab-icon">${icon("i-suitcase")}</span>
          <span class="trip-tab-copy"><strong>旅行清单</strong><small>${progress.checked} / ${progress.total} 件已带齐</small></span>
          <span class="trip-tab-arrow">${icon("i-chevron-right")}</span>
        </button>
        <button class="trip-detail-tab ${tripDetailTab === "journal" ? "is-active" : ""}" type="button" role="tab" data-action="set-trip-tab" data-trip-tab="journal" aria-selected="${tripDetailTab === "journal"}">
          <span class="trip-tab-icon">${icon("i-image")}</span>
          <span class="trip-tab-copy"><strong>记录见闻</strong><small>${(trip.journal || []).length} 条手记 · ${(trip.journal || []).reduce((sum, entry) => sum + (entry.images?.length || 0), 0)} 张照片</small></span>
          <span class="trip-tab-arrow">${icon("i-chevron-right")}</span>
        </button>
      </nav>

      ${tripDetailTab === "journal" ? renderJournalSection(trip) : `
      <section class="checklist-section" role="tabpanel" aria-label="旅行清单">
        <div class="checklist-toolbar">
          <h2>旅行清单 <small style="font-family:var(--sans-font);font-size:10px;color:var(--muted);font-weight:400">${onlyUnpacked ? `${visibleTotal} 件未带` : `${progress.total} 件物品`}</small></h2>
          <div class="checklist-actions">
            <button class="check-filter ${onlyUnpacked ? "is-active" : ""}" type="button" data-action="toggle-unpacked">${icon("i-eye")}只看未带</button>
            <button class="check-filter" type="button" data-action="expand-all">${icon("i-chevron-down")}全部展开</button>
            <button class="check-filter" type="button" data-action="add-category">${icon("i-plus")}分类</button>
          </div>
        </div>
        <div class="categories-wrap">
          ${renderTripCategories(trip)}
        </div>
      </section>
      `}

      <div class="trip-actions-bar">
        <button class="trip-action" type="button" data-action="set-reminder" data-trip-id="${trip.id}">${icon("i-bell")}出发提醒</button>
        <button class="trip-action" type="button" data-action="share-trip" data-trip-id="${trip.id}">${icon("i-share")}分享清单</button>
        <button class="trip-action" type="button" data-action="copy-trip" data-trip-id="${trip.id}">${icon("i-copy")}复制为新行程</button>
        <button class="trip-action" type="button" data-action="toggle-archive" data-trip-id="${trip.id}">${icon("i-archive")}${trip.status === "archived" ? "恢复使用" : "归档行程"}</button>
        <button class="trip-action" type="button" data-action="reset-checks" data-trip-id="${trip.id}">${icon("i-check")}重置勾选</button>
        <button class="trip-action danger" type="button" data-action="delete-trip" data-trip-id="${trip.id}">${icon("i-trash")}删除行程</button>
      </div>
    `;
    hydrateJournalImages(container);
  }

  function renderJournalSelectedPhotos() {
    if (!pendingJournalImages.length) {
      return `<p class="journal-photo-empty">${icon("i-image")} 还没有选择照片</p>`;
    }
    return pendingJournalImages.map((image) => `
      <div class="journal-selected-photo">
        <img src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
        <button type="button" data-remove-journal-photo="${image.id}" aria-label="移除${escapeHtml(image.name)}">${icon("i-x")}</button>
      </div>
    `).join("");
  }

  function renderJournalSection(trip) {
    const entries = Array.isArray(trip.journal) ? trip.journal : [];
    const imageCount = entries.reduce((sum, entry) => sum + (entry.images?.length || 0), 0);
    const draftText = journalDraftTripId === trip.id ? journalDraftText : "";
    return `
      <section class="travel-journal" id="travelJournal" role="tabpanel" aria-label="记录见闻">
        <div class="journal-heading">
          <div class="journal-heading-copy">
            <span class="journal-eyebrow">${icon("i-sparkle")} TRAVEL MEMORIES</span>
            <h2>旅途见闻</h2>
            <p>把路上的风景、心情和小故事留在这里。</p>
          </div>
          <span class="journal-count">${entries.length} 条手记 · ${imageCount} 张照片</span>
        </div>

        <div class="journal-composer">
          <label class="journal-text-field" for="journalEntryText">
            <span>此刻想记下什么？</span>
            <textarea id="journalEntryText" maxlength="1200" placeholder="例如：傍晚沿着海边走了很久，风很轻，夕阳把整条街染成了金色……">${escapeHtml(draftText)}</textarea>
          </label>
          <div class="journal-photo-selection" id="journalSelectedPhotos">${renderJournalSelectedPhotos()}</div>
          <div class="journal-composer-footer">
            <button class="journal-pick-photos" type="button" data-action="pick-journal-photos">${icon("i-image")} 从相册选择照片</button>
            <span id="journalPhotoStatus">最多 ${JOURNAL_MAX_PHOTOS} 张 · 自动压缩后保存在本机</span>
            <button class="button button-primary journal-save" type="button" data-action="save-journal-entry">${icon("i-check")} 保存见闻</button>
          </div>
        </div>

        <div class="journal-entries ${entries.length ? "" : "is-empty"}">
          ${entries.length ? entries.map((entry) => `
            <article class="journal-entry">
              <div class="journal-entry-head">
                <span>${icon("i-sparkle")} 旅途手记</span>
                <time datetime="${escapeHtml(entry.createdAt)}">${formatJournalDate(entry.createdAt)}</time>
                <button type="button" class="journal-delete" data-delete-journal-entry="${entry.id}" aria-label="删除这条旅途手记">${icon("i-trash")}</button>
              </div>
              ${entry.text ? `<p class="journal-entry-text">${escapeHtml(entry.text)}</p>` : ""}
              ${entry.images?.length ? `
                <div class="journal-photo-grid photo-count-${Math.min(entry.images.length, 4)}">
                  ${entry.images.map((image, index) => `
                    <button class="journal-photo" type="button" data-journal-image-id="${image.id}" aria-label="查看第 ${index + 1} 张照片">
                      <span class="journal-photo-loading">${icon("i-image")} 正在读取照片</span>
                    </button>
                  `).join("")}
                </div>
              ` : ""}
            </article>
          `).join("") : `
            <div class="journal-empty">
              <span>${icon("i-image")}</span>
              <div><strong>第一段旅途故事，等你来写</strong><p>写下感受并配上照片，再远的风景也会被好好记住。</p></div>
            </div>
          `}
        </div>
      </section>
    `;
  }

  async function hydrateJournalImages(root = document) {
    const targets = [...root.querySelectorAll("[data-journal-image-id]")];
    await Promise.all(targets.map(async (target) => {
      try {
        const dataUrl = await getJournalImage(target.dataset.journalImageId);
        if (!target.isConnected) return;
        if (!dataUrl) {
          target.classList.add("is-missing");
          target.innerHTML = `<span class="journal-photo-loading">${icon("i-image")} 照片未找到</span>`;
          return;
        }
        target.innerHTML = `<img src="${dataUrl}" alt="旅途照片" loading="lazy">`;
        target.classList.add("is-ready");
      } catch (error) {
        console.warn("读取旅途照片失败", error);
        if (target.isConnected) target.innerHTML = `<span class="journal-photo-loading">${icon("i-image")} 读取失败</span>`;
      }
    }));
  }

  function renderTripCategories(trip) {
    let visibleCategoryCount = 0;
    const html = trip.categories
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((category) => {
        const items = category.items
          .filter((item) => !onlyUnpacked || !item.checked)
          .sort((a, b) => a.order - b.order);
        if (onlyUnpacked && !items.length) return "";
        visibleCategoryCount += 1;
        const categoryProgress = getCategoryProgress(category);
        const isCollapsed = collapsedCategories.has(category.id);
        return `
          <section class="category-group ${isCollapsed ? "is-collapsed" : ""}" data-category-group="${category.id}">
            <div class="category-header" data-toggle-category="${category.id}" role="button" tabindex="0" aria-expanded="${!isCollapsed}">
              <span class="category-emoji" style="--category-bg:${categoryPalette[category.order % categoryPalette.length]}">${escapeHtml(category.emoji || "🧳")}</span>
              <span class="category-title"><strong>${escapeHtml(category.name)}</strong><span>${categoryProgress.checked} / ${categoryProgress.total} 已带</span></span>
              <span class="category-header-progress">
                <span class="linear-progress"><span style="width:${categoryProgress.percent}%"></span></span>
                <small>${categoryProgress.percent}%</small>
              </span>
              <span class="category-chevron">${icon("i-chevron-down")}</span>
            </div>
            <div class="category-items">
              ${items.map((item) => `
                <div class="check-item ${item.checked ? "is-checked" : ""}" data-check-item="${item.id}" data-category-id="${category.id}" role="checkbox" aria-checked="${item.checked}" tabindex="0">
                  <span class="custom-check">${icon("i-check")}</span>
                  <span class="check-name-wrap">
                    <span class="check-name">${escapeHtml(item.name)}</span>
                    ${item.note ? `<span class="check-note">${escapeHtml(item.note)}</span>` : ""}
                  </span>
                  <span class="quantity-chip">× ${item.quantity || 1}</span>
                  <button class="item-edit-button" type="button" data-edit-trip-item="${item.id}" data-category-id="${category.id}" aria-label="编辑${escapeHtml(item.name)}">${icon("i-more")}</button>
                </div>
              `).join("")}
              <button class="add-item-row" type="button" data-add-trip-item="${category.id}">${icon("i-plus")} 添加物品</button>
            </div>
          </section>
        `;
      })
      .join("");
    if (onlyUnpacked && !visibleCategoryCount) {
      return `<div class="filter-empty">所有物品都已带齐，可以出发啦。</div>`;
    }
    return html;
  }

  function renderTemplateDetail() {
    const template = currentProfile().templates.find((item) => item.id === currentTemplateId);
    const container = document.getElementById("templateDetailContent");
    if (!template) {
      showView("templates");
      return;
    }
    container.innerHTML = `
      <section class="template-detail-header" style="--template-bg:${safeColor(template.color)}">
        <div class="template-icon-large">${icon(template.icon || "i-grid")}</div>
        <div>
          <p class="eyebrow" style="margin-bottom:5px">${template.isSystem ? "系统模板" : "我的模板"}</p>
          <h1>${escapeHtml(template.name)}</h1>
          <p>${escapeHtml(template.description || "为下一次出发准备的自定义清单")}</p>
        </div>
        <div class="template-detail-actions">
          <button class="button button-primary" type="button" data-action="trip-from-template" data-template-id="${template.id}">${icon("i-plus")}用此模板新建</button>
          <button class="button button-light" type="button" data-action="share-template" data-template-id="${template.id}">${icon("i-share")}分享</button>
        </div>
      </section>
      <div class="template-detail-body">
        <div class="template-category-list">
          ${template.categories.map((category) => `
            <section class="template-category-row">
              <div class="template-category-title">
                <span><span class="category-emoji" style="width:32px;height:32px;font-size:15px">${escapeHtml(category.emoji || "🧳")}</span><strong>${escapeHtml(category.name)}</strong></span>
                <span style="display:flex;gap:5px">
                  <button class="bare-button" type="button" data-action="edit-template-category" data-category-id="${category.id}" aria-label="编辑分类">${icon("i-edit")}</button>
                  <button class="bare-button" type="button" data-action="delete-template-category" data-category-id="${category.id}" aria-label="删除分类">${icon("i-trash")}</button>
                </span>
              </div>
              <div class="template-check-list">
                ${category.items.map((item) => `
                  <div class="check-item ${item.checked ? "is-checked" : ""}" data-template-check-item="${item.id}" data-category-id="${category.id}" role="checkbox" aria-checked="${item.checked}" tabindex="0">
                    <span class="custom-check">${icon("i-check")}</span>
                    <span class="check-name-wrap">
                      <span class="check-name">${escapeHtml(item.name)}</span>
                      ${item.note ? `<span class="check-note">${escapeHtml(item.note)}</span>` : ""}
                    </span>
                    <span class="quantity-chip">× ${item.quantity || 1}</span>
                    <button class="item-edit-button" type="button" data-action="edit-template-item" data-category-id="${category.id}" data-item-id="${item.id}" aria-label="编辑${escapeHtml(item.name)}">${icon("i-edit")}</button>
                  </div>
                `).join("")}
                <button class="add-item-row" type="button" data-action="add-template-item" data-category-id="${category.id}">${icon("i-plus")} 添加物品</button>
              </div>
            </section>
          `).join("")}
          <button class="button button-outline button-wide" type="button" data-action="add-template-category">${icon("i-plus")} 添加新分类</button>
        </div>
        <aside>
          <section class="template-info-card">
            <h3>模板说明</h3>
            <p>点击物品左侧方框可设置默认携带状态。行程从模板创建后会成为独立副本，之后互不影响。</p>
            <div class="template-stat-grid">
              <div><strong>${template.categories.length}</strong><span>个分类</span></div>
              <div><strong>${getTemplateItemCount(template)}</strong><span>件物品</span></div>
            </div>
            <button class="settings-row action-row" type="button" data-action="rename-template"><span><strong>重命名模板</strong><small>${escapeHtml(template.name)}</small></span>${icon("i-edit")}</button>
            <button class="settings-row action-row danger-row" type="button" data-action="delete-template"><span><strong>删除这个模板</strong><small>不影响已经创建的行程</small></span>${icon("i-trash")}</button>
          </section>
        </aside>
      </div>
    `;
  }

  function renderSettings() {
    const profile = currentProfile();
    const settings = currentSettings();
    document.getElementById("profileSettingsList").innerHTML = store.profiles.map((item) => `
      <div class="profile-list-row ${item.id === profile.id ? "is-current" : ""}">
        <span class="avatar ${item.avatarClass}">${escapeHtml(item.name.slice(0, 1))}</span>
        <div><strong>${escapeHtml(item.name)}</strong><small>${item.trips.length} 个行程 · ${item.templates.length} 个模板</small></div>
        ${item.id === profile.id ? `<span class="current-pill">当前</span>` : `<button class="text-button" type="button" data-switch-profile="${item.id}">切换</button>`}
      </div>
    `).join("");
    const browserToggle = document.getElementById("browserNotifyToggle");
    const inAppToggle = document.getElementById("inAppNotifyToggle");
    browserToggle.checked = settings.browserNotify;
    inAppToggle.checked = settings.inAppNotify;
    document.getElementById("themeChoiceGrid").innerHTML = Object.entries(themes).map(([themeId, theme]) => `
      <button class="theme-choice ${settings.theme === themeId ? "is-active" : ""}" type="button" data-theme-choice="${themeId}" aria-pressed="${settings.theme === themeId}">
        <span class="theme-preview" style="--preview-bg:${theme.preview.background};--preview-paper:${theme.preview.paper};--preview-accent:${theme.preview.accent};--preview-ink:${theme.preview.ink};--preview-soft:${theme.preview.soft}">
          <i class="theme-preview-side"></i>
          <i class="theme-preview-card"><b></b><b></b><b></b></i>
          <i class="theme-preview-dot"></i>
        </span>
        <span class="theme-choice-copy"><strong>${escapeHtml(theme.name)}</strong><small>${escapeHtml(theme.description)}</small></span>
        <span class="theme-choice-check">${icon("i-check")}</span>
      </button>
    `).join("");
    updateNotificationPermissionLabel();
    document.getElementById("syncStatus").textContent = navigator.onLine ? "所有更改已保存" : "已保存到本机";
    document.getElementById("syncTime").textContent = formatShortTime(store.lastSavedAt);
  }

  function renderAllAndSave() {
    saveStore();
    renderAll();
  }

  function updateNavCount() {
    const count = getActiveTrips().length;
    const badge = document.getElementById("activeTripCount");
    if (badge) badge.textContent = count;
  }

  function showView(name, options = {}) {
    const target = document.getElementById(`view-${name}`);
    if (!target) return;
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view === target));
    const navName = name === "tripDetail" ? "trips" : name === "templateDetail" ? "templates" : name;
    document.querySelectorAll("[data-nav]").forEach((element) => {
      if (!element.classList.contains("nav-item") && !element.classList.contains("bottom-nav") && !element.parentElement?.classList.contains("bottom-nav")) return;
      element.classList.toggle("is-active", element.dataset.nav === navName);
    });
    document.querySelectorAll(".side-nav .nav-item, .bottom-nav > button[data-nav]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.nav === navName);
    });
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
    if (name === "trips") renderTrips();
    if (name === "templates") renderTemplates();
    if (name === "settings") renderSettings();
  }

  function openTrip(tripId) {
    const trip = currentProfile().trips.find((item) => item.id === tripId);
    if (!trip) {
      showToast("未找到这份行程", true);
      return;
    }
    if (currentTripId !== trip.id) {
      pendingJournalImages = [];
      journalDraftText = "";
      journalDraftTripId = trip.id;
    }
    currentTripId = trip.id;
    tripDetailTab = "checklist";
    collapsedCategories = new Set();
    onlyUnpacked = false;
    renderTripDetail();
    showView("tripDetail");
  }

  function openTemplate(templateId) {
    const template = currentProfile().templates.find((item) => item.id === templateId);
    if (!template) return;
    currentTemplateId = template.id;
    renderTemplateDetail();
    showView("templateDetail");
  }

  function safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#f8e9b9";
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " is-error" : ""}`;
    toast.innerHTML = `${icon(isError ? "i-x" : "i-check")}<span>${escapeHtml(message)}</span>`;
    dom.toastStack.append(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(6px)";
      setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  function openModal(content, { large = false, onSubmit = null } = {}) {
    lastFocusedElement = document.activeElement;
    modalSubmitHandler = onSubmit;
    dom.modalContent.innerHTML = content;
    dom.modal.classList.toggle("modal-large", large);
    dom.backdrop.hidden = false;
    document.body.classList.add("no-scroll");
    requestAnimationFrame(() => {
      const focusable = dom.modal.querySelector("input:not([type=hidden]), select, textarea, button");
      focusable?.focus();
    });
  }

  function closeModal() {
    dom.backdrop.hidden = true;
    dom.modal.classList.remove("modal-large");
    document.body.classList.remove("no-scroll");
    modalSubmitHandler = null;
    pendingImport = null;
    lastFocusedElement?.focus?.();
  }

  function openNewTripModal(templateId = null) {
    const templates = currentProfile().templates;
    if (!templates.length) {
      openNewTemplateModal();
      return;
    }
    const selectedId = templateId || templates[0].id;
    const selectedTemplate = templates.find((template) => template.id === selectedId) || templates[0];
    const today = new Date();
    openModal(`
      <div class="modal-icon coral">${icon("i-suitcase")}</div>
      <h2>准备下一站</h2>
      <p class="modal-subtitle">给这次出行取个名字，再挑一份清单模板。</p>
      <form class="modal-form" id="newTripForm">
        <div class="field">
          <label for="tripName">行程名称 *</label>
          <input id="tripName" name="name" required maxlength="30" placeholder="例如：10 月北京出差" autocomplete="off">
        </div>
        <div class="field">
          <label>选择清单模板</label>
          <div class="template-choice-grid">
            ${templates.slice(0, 6).map((template) => `
              <button class="template-choice ${template.id === selectedId ? "is-selected" : ""}" type="button" data-select-template="${template.id}" style="--choice-bg:${safeColor(template.color)}">
                ${icon(template.icon || "i-grid")}
                <strong>${escapeHtml(template.name)}</strong>
                <small>${getTemplateItemCount(template)} 件物品</small>
              </button>
            `).join("")}
          </div>
          <input type="hidden" name="templateId" value="${selectedTemplate.id}">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="tripStart">出发日期</label>
            <input id="tripStart" name="startDate" type="date" value="${dateInputValue(addDays(today, 3))}">
          </div>
          <div class="field">
            <label for="tripEnd">返程日期</label>
            <input id="tripEnd" name="endDate" type="date" value="${dateInputValue(addDays(today, 5))}">
          </div>
        </div>
        <div class="field">
          <label for="tripRoute">行程路线</label>
          <input id="tripRoute" name="route" maxlength="40" placeholder="例如：上海 → 杭州" autocomplete="off">
        </div>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
          <button class="button button-primary" type="submit">创建行程 ${icon("i-chevron-right")}</button>
        </div>
      </form>
    `, {
      onSubmit: (form) => {
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        const startDate = String(data.get("startDate") || "");
        const endDate = String(data.get("endDate") || "");
        if (!name) {
          showToast("请填写行程名称", true);
          return;
        }
        if (startDate && endDate && endDate < startDate) {
          showToast("返程日期不能早于出发日期", true);
          return;
        }
        const template = currentProfile().templates.find((item) => item.id === data.get("templateId")) || templates[0];
        const trip = createTripFromTemplate(template, {
          name,
          route: String(data.get("route") || "").trim() || "目的地待定",
          startDate,
          endDate
        });
        currentProfile().trips.unshift(trip);
        saveStore();
        closeModal();
        renderAll();
        showToast("行程已创建，开始收拾吧");
        setTimeout(() => openTrip(trip.id), 120);
      }
    });
  }

  function openNewTemplateModal() {
    openModal(`
      <div class="modal-icon">${icon("i-grid")}</div>
      <h2>新建一份模板</h2>
      <p class="modal-subtitle">你可以从空白开始，也可以复制一份现有清单的结构。</p>
      <form class="modal-form" id="newTemplateForm">
        <div class="field">
          <label for="templateName">模板名称 *</label>
          <input id="templateName" name="name" required maxlength="24" placeholder="例如：海边冲浪" autocomplete="off">
        </div>
        <div class="field">
          <label for="templateBase">初始内容</label>
          <select id="templateBase" name="baseId">
            <option value="">空白模板</option>
            ${currentProfile().templates.map((template) => `<option value="${template.id}">复制「${escapeHtml(template.name)}」的分类与物品</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="templateDescription">一句话说明</label>
          <input id="templateDescription" name="description" maxlength="60" placeholder="这份模板适合什么样的旅程？" autocomplete="off">
        </div>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
          <button class="button button-primary" type="submit">创建模板</button>
        </div>
      </form>
    `, {
      onSubmit: (form) => {
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        const baseId = String(data.get("baseId") || "");
        if (!name) {
          showToast("请填写模板名称", true);
          return;
        }
        const base = currentProfile().templates.find((template) => template.id === baseId);
        const template = {
          id: uid("tpl"),
          name,
          description: String(data.get("description") || "").trim() || "我的自定义清单模板",
          icon: "i-grid",
          color: categoryPalette[currentProfile().templates.length % categoryPalette.length],
          isSystem: false,
          order: currentProfile().templates.length,
          createdAt: new Date().toISOString(),
          categories: base ? base.categories.map((category, index) => ({
            id: uid("cat"),
            name: category.name,
            emoji: category.emoji,
            order: index,
            items: category.items.map((item, itemIndex) => ({
              id: uid("item"),
              name: item.name,
              quantity: item.quantity,
              note: item.note,
              checked: false,
              defaultChecked: Boolean(item.defaultChecked),
              order: itemIndex
            }))
          })) : []
        };
        currentProfile().templates.push(template);
        saveStore();
        closeModal();
        renderAll();
        showToast("新模板已创建");
        currentTemplateId = template.id;
        renderTemplateDetail();
        showView("templateDetail");
      }
    });
  }

  function openAddCategoryModal({ template = false } = {}) {
    const targetTrip = currentProfile().trips.find((trip) => trip.id === currentTripId);
    const targetTemplate = currentProfile().templates.find((item) => item.id === currentTemplateId);
    if (!template && !targetTrip) return;
    if (template && !targetTemplate) return;
    openModal(`
      <div class="modal-icon">${icon("i-folder")}</div>
      <h2>添加分类</h2>
      <p class="modal-subtitle">把同类物品放在一起，收拾时更容易找到。</p>
      <form class="modal-form" id="categoryForm">
        <div class="field-row">
          <div class="field">
            <label for="categoryName">分类名称 *</label>
            <input id="categoryName" name="name" required maxlength="16" placeholder="例如：摄影装备">
          </div>
          <div class="field">
            <label for="categoryEmoji">图标</label>
            <select id="categoryEmoji" name="emoji">
              <option value="🧳">🧳 行李</option>
              <option value="🪪">🪪 证件</option>
              <option value="👕">👕 衣物</option>
              <option value="🧴">🧴 洗护</option>
              <option value="🔌">🔌 电子</option>
              <option value="💊">💊 药品</option>
              <option value="📷">📷 摄影</option>
              <option value="🍵">🍵 饮食</option>
            </select>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
          <button class="button button-primary" type="submit">添加分类</button>
        </div>
      </form>
    `, {
      onSubmit: (form) => {
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        if (!name) return;
        const container = template ? targetTemplate : targetTrip;
        container.categories.push({
          id: uid(template ? "cat" : "tripcat"),
          name,
          emoji: String(data.get("emoji") || "🧳"),
          order: container.categories.length,
          items: []
        });
        saveStore();
        closeModal();
        template ? renderTemplateDetail() : renderTripDetail();
        showToast("分类已添加");
      }
    });
  }

  function openItemModal({ mode = "add", categoryId, itemId = null, template = false }) {
    const trip = currentProfile().trips.find((entry) => entry.id === currentTripId);
    const tpl = currentProfile().templates.find((entry) => entry.id === currentTemplateId);
    const source = template ? tpl : trip;
    const category = source?.categories.find((entry) => entry.id === categoryId);
    const item = itemId ? category?.items.find((entry) => entry.id === itemId) : null;
    if (!source || !category) return;
    if (mode === "edit" && !item) return;
    openModal(`
      <div class="modal-icon ${mode === "edit" ? "" : "mint"}">${icon(mode === "edit" ? "i-edit" : "i-plus")}</div>
      <h2>${mode === "edit" ? "编辑物品" : "添加物品"}</h2>
      <p class="modal-subtitle">${template ? `正在编辑「${escapeHtml(category.name)}」分类。` : `添加到「${escapeHtml(category.name)}」，修改只影响本次行程。`}</p>
      <form class="modal-form" id="itemForm">
        <div class="field">
          <label for="itemName">物品名称 *</label>
          <input id="itemName" name="name" required maxlength="40" value="${escapeHtml(item?.name || "")}" placeholder="例如：相机电池">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="itemQuantity">数量</label>
            <input id="itemQuantity" name="quantity" type="number" min="1" max="99" value="${item?.quantity || 1}">
          </div>
          <div class="field">
            <label for="itemNote">备注</label>
            <input id="itemNote" name="note" maxlength="80" value="${escapeHtml(item?.note || "")}" placeholder="可选">
          </div>
        </div>
        <div class="modal-actions">
          ${mode === "edit" ? `<button class="button button-ghost" type="button" data-action="delete-source-item" data-category-id="${categoryId}" data-item-id="${itemId}" style="color:var(--danger);margin-right:auto">${icon("i-trash")}删除</button>` : ""}
          <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
          <button class="button button-primary" type="submit">${mode === "edit" ? "保存修改" : "添加到清单"}</button>
        </div>
      </form>
    `, {
      onSubmit: (form) => {
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        if (!name) {
          showToast("请填写物品名称", true);
          return;
        }
        const payload = {
          name,
          quantity: Math.max(1, Math.min(99, Number(data.get("quantity")) || 1)),
          note: String(data.get("note") || "").trim()
        };
        if (mode === "edit" && item) {
          Object.assign(item, payload);
        } else {
          category.items.push({
            id: uid(template ? "item" : "tripitem"),
            ...payload,
            checked: false,
            order: category.items.length
          });
        }
        saveStore();
        closeModal();
        template ? renderTemplateDetail() : renderTripDetail();
        showToast(mode === "edit" ? "物品已更新" : "已添加物品");
      }
    });
  }

  function openReminderModal(tripId = null) {
    const trip = currentProfile().trips.find((entry) => entry.id === (tripId || currentTripId)) || getActiveTrips()[0];
    if (!trip) {
      showToast("请先创建一份行程", true);
      return;
    }
    currentTripId = trip.id;
    const baseDate = trip.startDate ? parseLocalDate(trip.startDate) : addDays(new Date(), 1);
    baseDate.setDate(baseDate.getDate() - 1);
    baseDate.setHours(20, 0, 0, 0);
    const defaultTime = baseDate.getTime() < Date.now() ? new Date(Date.now() + 3600000) : baseDate;
    openModal(`
      <div class="modal-icon">${icon("i-bell")}</div>
      <h2>出发提醒</h2>
      <p class="modal-subtitle">为「${escapeHtml(trip.name)}」设置一个或多个提醒时间。</p>
      <div class="reminder-list">
        ${(trip.reminders || []).length ? trip.reminders.slice().sort((a, b) => new Date(a.triggerAt) - new Date(b.triggerAt)).map((reminder) => `
          <div class="reminder-row">
            <span>${icon("i-clock")}</span>
            <div><strong>${formatDateTime(reminder.triggerAt)}</strong><small>${reminder.sent ? "已发送" : reminder.enabled === false ? "已关闭" : "等待提醒"} · ${reminder.channels.includes("browser") ? "浏览器" : "站内"}</small></div>
            <button type="button" data-delete-reminder="${reminder.id}" aria-label="删除提醒">${icon("i-trash")}</button>
          </div>
        `).join("") : `<div class="filter-empty">还没有提醒，添加一个合适的时间吧。</div>`}
      </div>
      <form class="modal-form" id="reminderForm">
        <div class="field-row">
          <div class="field">
            <label for="reminderTime">提醒时间</label>
            <input id="reminderTime" name="triggerAt" type="datetime-local" required value="${dateTimeInputValue(defaultTime)}">
          </div>
          <div class="field">
            <label for="reminderChannel">提醒方式</label>
            <select id="reminderChannel" name="channel">
              <option value="inApp">站内提醒</option>
              <option value="browser">浏览器通知</option>
            </select>
          </div>
        </div>
        <div class="field-hint">浏览器通知需要先在设置中授权。关闭网页时，当前本地版不会在后台发送系统通知。</div>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-action="close-modal">完成</button>
          <button class="button button-primary" type="submit">${icon("i-plus")}添加提醒</button>
        </div>
      </form>
    `, {
      onSubmit: async (form) => {
        const data = new FormData(form);
        const triggerAt = String(data.get("triggerAt") || "");
        if (!triggerAt) {
          showToast("请选择提醒时间", true);
          return;
        }
        if (new Date(triggerAt).getTime() <= Date.now()) {
          showToast("提醒时间需要晚于现在", true);
          return;
        }
        const channel = String(data.get("channel") || "inApp");
        if (channel === "browser") {
          const allowed = await requestNotificationPermission();
          if (!allowed) {
            showToast("未获得浏览器通知权限，已改为站内提醒");
          }
        }
        trip.reminders = Array.isArray(trip.reminders) ? trip.reminders : [];
        trip.reminders.push({
          id: uid("reminder"),
          triggerAt,
          channels: [channel === "browser" ? "browser" : "inApp"],
          enabled: true,
          sent: false,
          createdAt: new Date().toISOString()
        });
        saveStore();
        closeModal();
        renderAll();
        scheduleReminders();
        showToast("出发提醒已添加");
      }
    });
  }

  function openShareModal({ type = "trip", sourceId = null, initialTab = "generate" } = {}) {
    const isTemplate = type === "template";
    const source = isTemplate
      ? currentProfile().templates.find((item) => item.id === (sourceId || currentTemplateId))
      : currentProfile().trips.find((item) => item.id === (sourceId || currentTripId));
    if (!source) {
      showToast("未找到需要分享的内容", true);
      return;
    }
    openModal(`
      <div class="modal-icon coral">${icon("i-share")}</div>
      <h2>分享给同行的人</h2>
      <p class="modal-subtitle">只分享这份内容，不会公开你的其他行程。好友码默认 7 天有效。</p>
      <div class="share-tabs">
        <button class="${initialTab === "generate" ? "is-active" : ""}" type="button" data-share-tab="generate">生成好友码</button>
        <button class="${initialTab === "import" ? "is-active" : ""}" type="button" data-share-tab="import">通过好友码导入</button>
      </div>
      <div class="share-panel ${initialTab === "generate" ? "is-active" : ""}" data-share-panel="generate">
        <div class="share-preview">
          <div class="share-preview-title">
            <span class="template-icon-large" style="--template-bg:${safeColor(source.color)}">${icon(isTemplate ? (source.icon || "i-grid") : "i-suitcase")}</span>
            <span><strong>${escapeHtml(source.name)}</strong><small>${isTemplate ? `${source.categories.length} 个分类 · ${getTemplateItemCount(source)} 件物品` : `${getTripProgress(source).total} 件物品的本次行程`}</small></span>
          </div>
        </div>
        <form class="modal-form" id="shareForm" style="margin-top:14px">
          <label class="permission-option"><input type="radio" name="permission" value="copy" checked><span><strong>查看并复制</strong><small>对方确认后创建自己的独立副本</small></span></label>
          <label class="permission-option"><input type="radio" name="permission" value="view"><span><strong>仅查看</strong><small>对方只能预览，不能复制内容</small></span></label>
          <div class="field-row" style="margin-top:6px">
            <div class="field">
              <label for="shareExpiry">有效期</label>
              <select id="shareExpiry" name="expiry">
                <option value="1">1 天</option>
                <option value="7" selected>7 天</option>
                <option value="30">30 天</option>
              </select>
            </div>
            <div class="field">
              <label for="shareScope">分享范围</label>
              <select id="shareScope"><option>${isTemplate ? "整份模板" : "整份行程"}</option></select>
            </div>
          </div>
          <div class="modal-actions"><button class="button button-primary button-wide" type="submit">生成好友码 ${icon("i-chevron-right")}</button></div>
        </form>
        <div id="generatedCode"></div>
      </div>
      <div class="share-panel ${initialTab === "import" ? "is-active" : ""}" data-share-panel="import">
        <form class="modal-form" id="importCodeForm">
          <div class="field">
            <label for="friendCode">好友码</label>
            <input id="friendCode" name="code" maxlength="10" placeholder="输入 8 位好友码" autocomplete="off" style="text-transform:uppercase;letter-spacing:.15em;font-weight:700">
            <span class="field-hint">好友码绑定分享人设定的有效期、范围与复制权限。</span>
          </div>
          <div class="modal-actions">
            <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
            <button class="button button-primary" type="submit">验证并预览</button>
          </div>
        </form>
        <div id="importPreview"></div>
      </div>
    `, {
      onSubmit: (form) => {
        if (form.id === "shareForm") {
          const data = new FormData(form);
          const days = Number(data.get("expiry")) || 7;
          const token = generateFriendCode();
          const share = {
            id: uid("share"),
            code: token,
            type,
            sourceId: source.id,
            sourceName: source.name,
            permission: String(data.get("permission") || "copy"),
            expiresAt: addDays(new Date(), days).toISOString(),
            createdAt: new Date().toISOString(),
            usedCount: 0,
            active: true,
            snapshot: isTemplate ? deepClone(source) : deepClone(source)
          };
          currentProfile().shares.push(share);
          saveStore();
          document.getElementById("generatedCode").innerHTML = `
            <div class="code-result"><code>${share.code}</code><button type="button" data-copy-code="${share.code}" aria-label="复制好友码">${icon("i-copy")}</button></div>
            <p class="field-hint" style="margin-top:8px">有效期至 ${formatDateTime(share.expiresAt)}，可在设置中撤销。</p>
          `;
          showToast("好友码已生成");
          form.querySelector('button[type="submit"]').textContent = "重新生成";
          return;
        }
        if (form.id === "importCodeForm") {
          const data = new FormData(form);
          const token = String(data.get("code") || "").trim().toUpperCase();
          const result = findShareByCode(token);
          const preview = document.getElementById("importPreview");
          if (!result.valid) {
            preview.innerHTML = `<div class="copy-result" style="color:var(--danger);background:#faeeeb">${escapeHtml(result.reason)}</div>`;
            return;
          }
          const share = result.share;
          const snapshot = share.snapshot;
          preview.innerHTML = `
            <div class="share-preview" style="margin-top:14px">
              <div class="share-preview-title">
                <span class="template-icon-large" style="--template-bg:${safeColor(snapshot.color)}">${icon(share.type === "template" ? (snapshot.icon || "i-grid") : "i-suitcase")}</span>
                <span><strong>${escapeHtml(share.sourceName)}</strong><small>来自 ${escapeHtml(result.ownerName)} · ${share.permission === "view" ? "仅查看" : "可复制"}</small></span>
              </div>
              <p class="field-hint" style="margin:11px 0 0">${share.type === "template" ? `${snapshot.categories?.length || 0} 个分类` : `${snapshot.categories?.reduce((sum, cat) => sum + (cat.items?.length || 0), 0) || 0} 件物品`} · 有效期至 ${formatDateTime(share.expiresAt)}</p>
            </div>
            <div class="modal-actions">
              ${share.permission === "copy" ? `<button class="button button-primary button-wide" type="button" data-import-share="${share.id}" data-owner-id="${result.ownerId}">确认并复制到我的模板</button>` : `<span class="field-hint">此分享仅允许查看，不能创建副本。</span>`}
            </div>
          `;
        }
      }
    });
  }

  function generateFriendCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do {
      code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    } while (store.profiles.some((profile) => profile.shares?.some((share) => share.code === code)));
    return code;
  }

  function findShareByCode(code) {
    for (const profile of store.profiles) {
      const share = (profile.shares || []).find((item) => item.code === code);
      if (share) {
        if (!share.active) return { valid: false, reason: "这个好友码已被撤销" };
        if (new Date(share.expiresAt).getTime() < Date.now()) return { valid: false, reason: "这个好友码已经过期" };
        if (!share.snapshot) return { valid: false, reason: "好友码内容不完整" };
        return { valid: true, share, ownerId: profile.id, ownerName: profile.name };
      }
    }
    return { valid: false, reason: "没有找到这个好友码，请检查后重试" };
  }

  function importShare(shareId, ownerId) {
    const owner = store.profiles.find((profile) => profile.id === ownerId);
    const share = owner?.shares.find((item) => item.id === shareId);
    if (!share || share.permission !== "copy") {
      showToast("此好友码不允许复制", true);
      return;
    }
    const snapshot = deepClone(share.snapshot);
    const template = {
      id: uid("tpl"),
      name: snapshot.name || "导入的清单",
      description: `来自 ${owner.name} 的分享 · ${new Date().toLocaleDateString("zh-CN")}`,
      icon: snapshot.icon || "i-suitcase",
      color: safeColor(snapshot.color),
      isSystem: false,
      order: currentProfile().templates.length,
      createdAt: new Date().toISOString(),
      categories: (snapshot.categories || []).map((category, index) => ({
        id: uid("cat"),
        name: category.name,
        emoji: category.emoji || "🧳",
        order: index,
        items: (category.items || []).map((item, itemIndex) => ({
          id: uid("item"),
          name: item.name,
          quantity: item.quantity || 1,
          note: item.note || "",
          checked: false,
          order: itemIndex
        }))
      }))
    };
    currentProfile().templates.push(template);
    share.usedCount = (share.usedCount || 0) + 1;
    saveStore();
    closeModal();
    renderAll();
    showToast("已复制为你的独立模板");
    setTimeout(() => openTemplate(template.id), 120);
  }

  function openProfilesModal() {
    const profile = currentProfile();
    openModal(`
      <div class="modal-icon">${icon("i-users")}</div>
      <h2>本地资料档</h2>
      <p class="modal-subtitle">每位旅人的模板与行程彼此隔离，切换后会自动加载对应数据。</p>
      <div class="profile-modal-list">
        ${store.profiles.map((item) => `
          <button class="profile-modal-row ${item.id === profile.id ? "is-current" : ""}" type="button" data-switch-profile="${item.id}">
            <span class="avatar ${item.avatarClass}">${escapeHtml(item.name.slice(0, 1))}</span>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${item.id === profile.id ? "正在使用" : `${item.trips.length} 个行程`}</small>
          </button>
        `).join("")}
      </div>
      <form class="inline-add-profile" id="profileForm">
        <input name="name" maxlength="16" required placeholder="输入新资料档昵称">
        <button class="button button-primary" type="submit">${icon("i-plus")}新建</button>
      </form>
      <div class="modal-actions">
        <button class="button button-ghost" type="button" data-action="close-modal">完成</button>
      </div>
    `, {
      onSubmit: (form) => {
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        if (!name) return;
        const profileId = uid("profile");
        store.profiles.push({
          id: profileId,
          name,
          avatarClass: avatarClasses[store.profiles.length % avatarClasses.length],
          createdAt: new Date().toISOString(),
          templates: getTemplateSeeds().map(makeTemplate),
          trips: [],
          shares: [],
          settings: { browserNotify: false, inAppNotify: true, timezone: "Asia/Shanghai", theme: "cream" }
        });
        store.activeProfileId = profileId;
        saveStore();
        closeModal();
        renderAll();
        showToast(`已创建并切换到「${name}」`);
      }
    });
  }

  function switchProfile(profileId) {
    if (!store.profiles.some((profile) => profile.id === profileId)) return;
    store.activeProfileId = profileId;
    currentTripId = null;
    currentTemplateId = null;
    saveStore();
    closeModal();
    renderAll();
    showView("dashboard");
    showToast(`已切换到「${currentProfile().name}」的资料档`);
  }

  function setTripDetailTab(tab) {
    const textarea = document.getElementById("journalEntryText");
    if (textarea) {
      journalDraftTripId = currentTripId;
      journalDraftText = textarea.value;
    }
    tripDetailTab = tab === "journal" ? "journal" : "checklist";
    renderTripDetail();
    requestAnimationFrame(() => document.querySelector(".trip-detail-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function refreshJournalPhotoSelection() {
    const container = document.getElementById("journalSelectedPhotos");
    const status = document.getElementById("journalPhotoStatus");
    if (container) container.innerHTML = renderJournalSelectedPhotos();
    if (status) {
      status.textContent = pendingJournalImages.length
        ? `已选 ${pendingJournalImages.length} / ${JOURNAL_MAX_PHOTOS} 张 · 保存后写入本机`
        : `最多 ${JOURNAL_MAX_PHOTOS} 张 · 自动压缩后保存在本机`;
    }
  }

  async function handleJournalPhotoSelection(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const textarea = document.getElementById("journalEntryText");
    journalDraftText = textarea?.value || journalDraftText;
    journalDraftTripId = currentTripId;
    const available = JOURNAL_MAX_PHOTOS - pendingJournalImages.length;
    if (available <= 0) {
      showToast(`每条手记最多添加 ${JOURNAL_MAX_PHOTOS} 张照片`, true);
      return;
    }
    const selectedFiles = files.slice(0, available);
    const status = document.getElementById("journalPhotoStatus");
    if (status) status.textContent = `正在读取 ${selectedFiles.length} 张照片…`;
    const failures = [];
    for (const file of selectedFiles) {
      try {
        pendingJournalImages.push(await prepareJournalImage(file));
        refreshJournalPhotoSelection();
      } catch (error) {
        failures.push(error.message || "照片读取失败");
      }
    }
    refreshJournalPhotoSelection();
    if (files.length > available) showToast(`每条手记最多 ${JOURNAL_MAX_PHOTOS} 张照片，多出的照片未添加`, true);
    else if (failures.length) showToast(failures[0], true);
    else showToast(`已选择 ${selectedFiles.length} 张照片`);
  }

  async function saveJournalEntry() {
    const trip = currentProfile().trips.find((entry) => entry.id === currentTripId);
    if (!trip) return;
    const textarea = document.getElementById("journalEntryText");
    const text = String(textarea?.value || journalDraftText || "").trim();
    journalDraftText = text;
    journalDraftTripId = trip.id;
    if (!text && !pendingJournalImages.length) {
      showToast("请写点见闻或先选择照片");
      textarea?.focus();
      return;
    }
    const saveButton = document.querySelector('[data-action="save-journal-entry"]');
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "正在保存…";
    }
    const imagesForEntry = pendingJournalImages.slice();
    try {
      await Promise.all(imagesForEntry.map((image) => putJournalImage(image.id, image.dataUrl)));
      const entry = {
        id: uid("journal"),
        text: text.slice(0, 1200),
        createdAt: new Date().toISOString(),
        images: imagesForEntry.map((image) => ({ id: image.id, name: image.name }))
      };
      trip.journal = [entry, ...(Array.isArray(trip.journal) ? trip.journal : [])];
      pendingJournalImages = [];
      journalDraftText = "";
      saveStore();
      renderTripDetail();
      requestAnimationFrame(() => document.getElementById("travelJournal")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      showToast("旅途见闻已保存");
    } catch (error) {
      console.error("保存旅途见闻失败", error);
      await deleteJournalImages(imagesForEntry.map((image) => image.id)).catch(() => {});
      showToast("照片保存失败，请检查浏览器存储空间", true);
    } finally {
      const nextButton = document.querySelector('[data-action="save-journal-entry"]');
      if (nextButton) {
        nextButton.disabled = false;
        nextButton.innerHTML = `${icon("i-check")} 保存见闻`;
      }
    }
  }

  function deleteJournalEntry(entryId) {
    const trip = currentProfile().trips.find((entry) => entry.id === currentTripId);
    const entry = trip?.journal?.find((item) => item.id === entryId);
    if (!trip || !entry) return;
    openConfirm({
      title: "删除这条旅途见闻？",
      message: "文字和所选照片都会从当前设备中删除，此操作无法撤销。",
      target: entry.text ? entry.text.slice(0, 44) : `${entry.images?.length || 0} 张照片`,
      confirmText: "确认删除",
      danger: true,
      onConfirm: () => {
        trip.journal = trip.journal.filter((item) => item.id !== entryId);
        deleteJournalImages((entry.images || []).map((image) => image.id)).catch((error) => console.warn("清理照片失败", error));
        saveStore();
        renderTripDetail();
        showToast("旅途见闻已删除");
      }
    });
  }

  async function openJournalImage(imageId) {
    try {
      const dataUrl = await getJournalImage(imageId);
      if (!dataUrl) {
        showToast("这张照片已不在当前设备中", true);
        return;
      }
      openModal(`
        <div class="journal-lightbox">
          <img src="${dataUrl}" alt="旅途照片">
          <p>${icon("i-image")} 照片仅保存在当前设备</p>
          <button class="button button-primary" type="button" data-action="close-modal">关闭</button>
        </div>
      `);
    } catch (error) {
      console.error("打开照片失败", error);
      showToast("照片读取失败", true);
    }
  }

  function openConfirm({ title, message, target, confirmText = "确认", danger = false, onConfirm }) {
    openModal(`
      <div class="modal-icon ${danger ? "coral" : "mint"}">${icon(danger ? "i-trash" : "i-check")}</div>
      <h2>${escapeHtml(title)}</h2>
      <p class="confirm-copy">${escapeHtml(message)}</p>
      ${target ? `<div class="confirm-target">${escapeHtml(target)}</div>` : ""}
      <div class="modal-actions">
        <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
        <button class="button ${danger ? "button-danger" : "button-primary"}" id="confirmAction" type="button">${escapeHtml(confirmText)}</button>
      </div>
    `);
    document.getElementById("confirmAction").addEventListener("click", () => {
      onConfirm();
      closeModal();
    }, { once: true });
  }

  function resetTripChecks(tripId) {
    const trip = currentProfile().trips.find((item) => item.id === tripId);
    if (!trip) return;
    openConfirm({
      title: "重置全部勾选？",
      message: "所有物品会重新变为“未带”，数量和备注不会改变。此操作需要重新确认。",
      target: `${trip.name} · ${getTripProgress(trip).total} 件物品`,
      confirmText: "确认重置",
      danger: true,
      onConfirm: () => {
        trip.categories.forEach((category) => category.items.forEach((item) => { item.checked = false; }));
        saveStore();
        renderAll();
        showToast("勾选状态已重置");
      }
    });
  }

  function copyTrip(tripId) {
    const trip = currentProfile().trips.find((item) => item.id === tripId);
    if (!trip) return;
    const copy = deepClone(trip);
    copy.id = uid("trip");
    copy.name = `${trip.name} · 副本`;
    copy.status = "active";
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = new Date().toISOString();
    copy.reminders = [];
    copy.journal = [];
    copy.categories.forEach((category) => {
      category.id = uid("tripcat");
      category.items.forEach((item) => {
        item.id = uid("tripitem");
        item.checked = false;
      });
    });
    currentProfile().trips.unshift(copy);
    saveStore();
    renderAll();
    showToast("已复制为新的行程");
    setTimeout(() => openTrip(copy.id), 100);
  }

  function openTemplatesFromTrip() {
    showView("templates");
  }

  function openTemplateRenameModal() {
    const template = currentProfile().templates.find((item) => item.id === currentTemplateId);
    if (!template) return;
    openModal(`
      <div class="modal-icon">${icon("i-edit")}</div>
      <h2>编辑模板信息</h2>
      <p class="modal-subtitle">修改名称和说明，不会影响已创建的行程。</p>
      <form class="modal-form" id="renameTemplateForm">
        <div class="field"><label for="renameTemplateName">模板名称</label><input id="renameTemplateName" name="name" maxlength="24" required value="${escapeHtml(template.name)}"></div>
        <div class="field"><label for="renameTemplateDescription">模板说明</label><input id="renameTemplateDescription" name="description" maxlength="60" value="${escapeHtml(template.description || "")}"></div>
        <div class="modal-actions">
          <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
          <button class="button button-primary" type="submit">保存</button>
        </div>
      </form>
    `, {
      onSubmit: (form) => {
        const data = new FormData(form);
        template.name = String(data.get("name") || "").trim() || template.name;
        template.description = String(data.get("description") || "").trim();
        saveStore();
        closeModal();
        renderAll();
        showToast("模板信息已更新");
      }
    });
  }

  function openCategoryRenameModal(categoryId) {
    const template = currentProfile().templates.find((item) => item.id === currentTemplateId);
    const category = template?.categories.find((item) => item.id === categoryId);
    if (!category) return;
    openModal(`
      <div class="modal-icon">${icon("i-edit")}</div>
      <h2>编辑分类</h2>
      <p class="modal-subtitle">分类名称会更新到之后从模板创建的行程。</p>
      <form class="modal-form">
        <div class="field"><label for="renameCategoryName">分类名称</label><input id="renameCategoryName" name="name" maxlength="16" required value="${escapeHtml(category.name)}"></div>
        <div class="modal-actions"><button class="button button-ghost" type="button" data-action="close-modal">取消</button><button class="button button-primary" type="submit">保存</button></div>
      </form>
    `, {
      onSubmit: (form) => {
        const name = String(new FormData(form).get("name") || "").trim();
        if (!name) return;
        category.name = name;
        saveStore();
        closeModal();
        renderTemplateDetail();
        showToast("分类已更新");
      }
    });
  }

  function deleteTemplateCategory(categoryId) {
    const template = currentProfile().templates.find((item) => item.id === currentTemplateId);
    const index = template?.categories.findIndex((category) => category.id === categoryId);
    if (!template || index < 0) return;
    const category = template.categories[index];
    openConfirm({
      title: "删除这个分类？",
      message: `${category.items.length} 件物品会一并从模板中移除。已经创建的行程不会受到影响。`,
      target: category.name,
      confirmText: "确认删除",
      danger: true,
      onConfirm: () => {
        template.categories.splice(index, 1);
        saveStore();
        renderAll();
        showToast("分类已删除");
      }
    });
  }

  function deleteSourceItem(categoryId, itemId) {
    const trip = currentProfile().trips.find((entry) => entry.id === currentTripId);
    const template = currentProfile().templates.find((entry) => entry.id === currentTemplateId);
    const source = document.getElementById("view-templateDetail").classList.contains("is-active") ? template : trip;
    const category = source?.categories.find((entry) => entry.id === categoryId);
    const index = category?.items.findIndex((item) => item.id === itemId);
    if (!source || !category || index == null || index < 0) return;
    const itemName = category.items[index].name;
    openConfirm({
      title: "删除这件物品？",
      message: "删除后将从当前清单中移除，其他清单与模板不受影响。",
      target: itemName,
      confirmText: "确认删除",
      danger: true,
      onConfirm: () => {
        category.items.splice(index, 1);
        saveStore();
        renderAll();
        showToast("物品已删除");
      }
    });
  }

  function deleteTemplate(templateId = currentTemplateId) {
    const profile = currentProfile();
    const index = profile.templates.findIndex((template) => template.id === templateId);
    if (index < 0) return;
    const template = profile.templates[index];
    openConfirm({
      title: "删除这份模板？",
      message: "已从模板创建的行程会保留，但这份模板不能再用于新建行程。",
      target: `${template.name} · ${template.categories.length} 个分类`,
      confirmText: "确认删除",
      danger: true,
      onConfirm: () => {
        profile.templates.splice(index, 1);
        currentTemplateId = null;
        saveStore();
        renderAll();
        showView("templates");
        showToast("模板已删除");
      }
    });
  }

  function deleteTrip(tripId) {
    const profile = currentProfile();
    const index = profile.trips.findIndex((trip) => trip.id === tripId);
    if (index < 0) return;
    const trip = profile.trips[index];
    const imageIds = getTripJournalImages([trip]);
    openConfirm({
      title: "删除这份行程？",
      message: "行程内的勾选、备注和提醒都会被删除。这个操作无法撤销。",
      target: `${trip.name} · ${getTripProgress(trip).total} 件物品`,
      confirmText: "确认删除",
      danger: true,
      onConfirm: () => {
        profile.trips.splice(index, 1);
        deleteJournalImages(imageIds).catch((error) => console.warn("清理旅途照片失败", error));
        currentTripId = null;
        saveStore();
        renderAll();
        showView("trips");
        showToast("行程已删除");
      }
    });
  }

  function archiveTrip(tripId) {
    const trip = currentProfile().trips.find((item) => item.id === tripId);
    if (!trip) return;
    trip.status = trip.status === "archived" ? "active" : "archived";
    saveStore();
    renderAll();
    showToast(trip.status === "archived" ? "行程已归档" : "行程已恢复");
  }

  function requestNotificationPermission() {
    if (!("Notification" in window)) {
      showToast("当前浏览器不支持系统通知", true);
      return Promise.resolve(false);
    }
    if (Notification.permission === "granted") {
      currentSettings().browserNotify = true;
      saveStore({ quiet: true });
      updateNotificationPermissionLabel();
      return Promise.resolve(true);
    }
    if (Notification.permission === "denied") {
      showToast("浏览器通知已被禁用，请在浏览器设置中开启", true);
      currentSettings().browserNotify = false;
      saveStore({ quiet: true });
      renderSettings();
      return Promise.resolve(false);
    }
    return Notification.requestPermission().then((permission) => {
      const allowed = permission === "granted";
      currentSettings().browserNotify = allowed;
      saveStore({ quiet: true });
      renderSettings();
      showToast(allowed ? "浏览器通知已开启" : "未获得通知权限", !allowed);
      return allowed;
    }).catch(() => false);
  }

  function updateNotificationPermissionLabel() {
    const label = document.getElementById("notificationPermission");
    const toggle = document.getElementById("browserNotifyToggle");
    if (!label || !toggle) return;
    if (!("Notification" in window)) {
      label.textContent = "当前浏览器不支持";
      toggle.checked = false;
      toggle.disabled = true;
      return;
    }
    const labels = { granted: "已授权 · 浏览器打开时提醒", denied: "浏览器已禁用", default: "尚未授权" };
    label.textContent = labels[Notification.permission] || "尚未授权";
    toggle.checked = currentSettings().browserNotify && Notification.permission === "granted";
  }

  function scheduleReminders() {
    const now = Date.now();
    getActiveTrips().forEach((trip) => {
      (trip.reminders || []).forEach((reminder) => {
        if (!reminder.enabled || reminder.sent) return;
        const delay = new Date(reminder.triggerAt).getTime() - now;
        if (delay > 0 && delay < 2147483647) {
          window.setTimeout(() => fireReminder(trip.id, reminder.id), delay + 300);
        } else if (delay <= 0 && delay > -60000) {
          fireReminder(trip.id, reminder.id);
        }
      });
    });
  }

  function fireReminder(tripId, reminderId) {
    const trip = currentProfile().trips.find((entry) => entry.id === tripId);
    const reminder = trip?.reminders?.find((entry) => entry.id === reminderId);
    if (!trip || !reminder || reminder.sent || reminder.enabled === false) return;
    reminder.sent = true;
    reminder.sentAt = new Date().toISOString();
    const progress = getTripProgress(trip);
    const topRemaining = trip.categories.flatMap((category) => category.items)
      .filter((item) => !item.checked)
      .slice(0, 3)
      .map((item) => item.name);
    const message = `${trip.name} 还没带齐，还剩 ${progress.remaining} 件${topRemaining.length ? `：${topRemaining.join("、")}` : ""}`;
    if (reminder.channels.includes("browser") && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("收拾亿下就出发", { body: message, icon: "icon.svg", tag: `trip-${trip.id}` });
      } catch (error) {
        console.warn("浏览器通知发送失败", error);
      }
    }
    if (currentSettings().inAppNotify) showToast(message);
    saveStore({ quiet: true });
    renderDashboard();
  }

  async function exportData() {
    const snapshot = deepClone(store);
    snapshot.journalMedia = {};
    const imageIds = getTripJournalImages(store.profiles.flatMap((profile) => profile.trips));
    for (const imageId of imageIds) {
      try {
        const dataUrl = await getJournalImage(imageId);
        if (dataUrl) snapshot.journalMedia[imageId] = dataUrl;
      } catch (error) {
        console.warn("导出旅途照片失败", imageId, error);
      }
    }
    const payload = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `收拾亿下备份-${dateInputValue(new Date())}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("备份已导出，请妥善保管");
  }

  function previewImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const normalized = normalizeStore(parsed);
        pendingImport = normalized;
        pendingImportMedia = parsed.journalMedia && typeof parsed.journalMedia === "object" ? parsed.journalMedia : {};
        const tripCount = normalized.profiles.reduce((sum, profile) => sum + profile.trips.length, 0);
        const templateCount = normalized.profiles.reduce((sum, profile) => sum + profile.templates.length, 0);
        const photoCount = Object.values(pendingImportMedia).filter((value) => typeof value === "string" && value.startsWith("data:image/")).length;
        openModal(`
          <div class="modal-icon mint">${icon("i-upload")}</div>
          <h2>导入数据备份</h2>
          <p class="modal-subtitle">请确认以下备份内容。导入后会替换当前浏览器中的本地数据，建议先导出当前数据。</p>
          <div class="import-preview">
            <div><strong>${normalized.profiles.length}</strong><span>个本地资料档</span></div>
            <div><strong>${tripCount}</strong><span>个行程</span></div>
            <div><strong>${templateCount}</strong><span>份模板</span></div>
            <div><strong>${photoCount}</strong><span>张旅途照片</span></div>
          </div>
          <div class="modal-actions">
            <button class="button button-ghost" type="button" data-action="close-modal">取消</button>
            <button class="button button-primary" id="applyImport" type="button">确认覆盖并导入</button>
          </div>
        `);
        document.getElementById("applyImport").addEventListener("click", async () => {
          if (!pendingImport) return;
          const importButton = document.getElementById("applyImport");
          if (importButton) {
            importButton.disabled = true;
            importButton.textContent = "正在恢复…";
          }
          const nextStore = pendingImport;
          const media = pendingImportMedia;
          const oldImageIds = getTripJournalImages(store.profiles.flatMap((profile) => profile.trips));
          try {
            const validMedia = Object.entries(media).filter(([, value]) => typeof value === "string" && value.startsWith("data:image/"));
            await Promise.all(validMedia.map(([imageId, dataUrl]) => putJournalImage(imageId, dataUrl)));
            store = nextStore;
            pendingImport = null;
            pendingImportMedia = {};
            saveStore();
            await deleteJournalImages(oldImageIds.filter((imageId) => !(imageId in media))).catch(() => {});
            closeModal();
            renderAll();
            showView("dashboard");
            showToast("数据和旅途照片已恢复");
          } catch (error) {
            console.error("导入旅途照片失败", error);
            showToast("备份照片恢复失败，请检查浏览器存储空间", true);
          }
        });
      } catch (error) {
        showToast(error.message || "备份文件无法读取", true);
      }
    };
    reader.readAsText(file);
  }

  function clearLocalData() {
    openConfirm({
      title: "清除全部本地数据？",
      message: "所有资料档、行程、模板、好友码和提醒都会被删除。操作无法撤销，建议先导出备份。",
      target: `${store.profiles.length} 个资料档 · ${store.profiles.reduce((sum, profile) => sum + profile.trips.length, 0)} 个行程`,
      confirmText: "清除全部数据",
      danger: true,
      onConfirm: () => {
        clearJournalImages().catch((error) => console.warn("清理旅途照片失败", error));
        localStorage.removeItem(STORAGE_KEY);
        store = createInitialStore();
        currentTripId = null;
        currentTemplateId = null;
        saveStore();
        renderAll();
        showView("dashboard");
        showToast("本地数据已清除，已恢复初始状态");
      }
    });
  }

  function renameCurrentProfile() {
    const profile = currentProfile();
    openModal(`
      <div class="modal-icon">${icon("i-edit")}</div>
      <h2>重命名资料档</h2>
      <p class="modal-subtitle">昵称只会显示在这台设备上。</p>
      <form class="modal-form">
        <div class="field"><label for="profileRename">昵称</label><input id="profileRename" name="name" maxlength="16" required value="${escapeHtml(profile.name)}"></div>
        <div class="modal-actions"><button class="button button-ghost" type="button" data-action="close-modal">取消</button><button class="button button-primary" type="submit">保存</button></div>
      </form>
    `, {
      onSubmit: (form) => {
        const name = String(new FormData(form).get("name") || "").trim();
        if (!name) return;
        profile.name = name;
        saveStore();
        closeModal();
        renderAll();
        showToast("昵称已更新");
      }
    });
  }

  function deleteCurrentProfile() {
    if (store.profiles.length <= 1) {
      showToast("至少需要保留一个本地资料档", true);
      return;
    }
    const profile = currentProfile();
    const imageIds = getTripJournalImages(profile.trips);
    openConfirm({
      title: "删除当前资料档？",
      message: "该资料档的行程、模板和提醒都会被永久删除。其他资料档不受影响。",
      target: profile.name,
      confirmText: "确认删除",
      danger: true,
      onConfirm: () => {
        deleteJournalImages(imageIds).catch((error) => console.warn("清理旅途照片失败", error));
        store.profiles = store.profiles.filter((item) => item.id !== profile.id);
        store.activeProfileId = store.profiles[0].id;
        currentTripId = null;
        currentTemplateId = null;
        saveStore();
        renderAll();
        showView("dashboard");
        showToast("资料档已删除");
      }
    });
  }

  function openRevokeSharesModal() {
    const shares = currentProfile().shares || [];
    openModal(`
      <div class="modal-icon coral">${icon("i-share")}</div>
      <h2>我的分享授权</h2>
      <p class="modal-subtitle">撤销后，好友码会立即失效，已复制的独立副本不受影响。</p>
      <div class="reminder-list">
        ${shares.length ? shares.slice().reverse().map((share) => `
          <div class="reminder-row">
            <span>${icon(share.type === "template" ? "i-grid" : "i-suitcase")}</span>
            <div><strong>${escapeHtml(share.sourceName)} · ${share.code}</strong><small>${share.active ? "有效" : "已撤销"} · 到期 ${formatDateTime(share.expiresAt)} · 使用 ${share.usedCount || 0} 次</small></div>
            ${share.active ? `<button type="button" data-revoke-share="${share.id}" aria-label="撤销分享">${icon("i-x")}</button>` : ""}
          </div>
        `).join("") : `<div class="filter-empty">还没有生成过好友码。</div>`}
      </div>
      <div class="modal-actions"><button class="button button-ghost" type="button" data-action="close-modal">完成</button><button class="button button-primary" type="button" data-action="share-current">新生成好友码</button></div>
    `);
  }

  function toggleSetting(name, checked) {
    if (name === "browserNotify" && checked) {
      requestNotificationPermission().then((allowed) => {
        if (!allowed) {
          currentSettings().browserNotify = false;
          saveStore({ quiet: true });
          renderSettings();
        }
      });
      return;
    }
    currentSettings()[name] = checked;
    saveStore({ quiet: true });
    if (name === "browserNotify" && !checked) updateNotificationPermissionLabel();
  }

  function handleAction(action, element) {
    switch (action) {
      case "new-trip":
        openNewTripModal();
        break;
      case "new-template":
        openNewTemplateModal();
        break;
      case "close-modal":
        closeModal();
        break;
      case "open-reminders":
        openReminderModal(currentTripId);
        break;
      case "set-reminder":
        openReminderModal(element.dataset.tripId || currentTripId);
        break;
      case "share-current":
        openShareModal({ type: "trip", sourceId: element.dataset.tripId || getActiveTrips()[0]?.id });
        break;
      case "share-trip":
        openShareModal({ type: "trip", sourceId: element.dataset.tripId || currentTripId });
        break;
      case "share-template":
        openShareModal({ type: "template", sourceId: element.dataset.templateId || currentTemplateId });
        break;
      case "import-code":
        openShareModal({ type: "template", initialTab: "import" });
        break;
      case "trip-from-template":
        openNewTripModal(element.dataset.templateId || currentTemplateId);
        break;
      case "profiles":
        openProfilesModal();
        break;
      case "pick-journal-photos":
        dom.journalPhotoInput.value = "";
        dom.journalPhotoInput.click();
        break;
      case "save-journal-entry":
        saveJournalEntry();
        break;
      case "set-trip-tab":
        setTripDetailTab(element.dataset.tripTab);
        break;
      case "toggle-unpacked":
        onlyUnpacked = !onlyUnpacked;
        renderTripDetail();
        break;
      case "expand-all":
        collapsedCategories.clear();
        renderTripDetail();
        break;
      case "add-category":
        openAddCategoryModal({ template: document.getElementById("view-templateDetail").classList.contains("is-active") });
        break;
      case "add-template-category":
        openAddCategoryModal({ template: true });
        break;
      case "edit-template-category":
        openCategoryRenameModal(element.dataset.categoryId);
        break;
      case "delete-template-category":
        deleteTemplateCategory(element.dataset.categoryId);
        break;
      case "add-template-item":
        openItemModal({ mode: "add", categoryId: element.dataset.categoryId, template: true });
        break;
      case "edit-template-item":
        openItemModal({ mode: "edit", categoryId: element.dataset.categoryId, itemId: element.dataset.itemId, template: true });
        break;
      case "delete-source-item":
        deleteSourceItem(element.dataset.categoryId, element.dataset.itemId);
        break;
      case "rename-template":
        openTemplateRenameModal();
        break;
      case "delete-template":
        deleteTemplate();
        break;
      case "reset-checks":
        resetTripChecks(element.dataset.tripId || currentTripId);
        break;
      case "copy-trip":
        copyTrip(element.dataset.tripId || currentTripId);
        break;
      case "toggle-archive":
        archiveTrip(element.dataset.tripId || currentTripId);
        break;
      case "delete-trip":
        deleteTrip(element.dataset.tripId || currentTripId);
        break;
      case "export-data":
        exportData();
        break;
      case "import-data":
        dom.importFile.click();
        break;
      case "clear-data":
        clearLocalData();
        break;
      case "rename-profile":
        renameCurrentProfile();
        break;
      case "delete-profile":
        deleteCurrentProfile();
        break;
      case "revoke-shares":
        openRevokeSharesModal();
        break;
      default:
        break;
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav]");
      if (nav) {
        event.preventDefault();
        showView(nav.dataset.nav);
        return;
      }

      const themeChoice = event.target.closest("[data-theme-choice]");
      if (themeChoice) {
        setTheme(themeChoice.dataset.themeChoice);
        return;
      }

      const profileSwitch = event.target.closest("[data-switch-profile]");
      if (profileSwitch) {
        switchProfile(profileSwitch.dataset.switchProfile);
        return;
      }

      const removeJournalPhoto = event.target.closest("[data-remove-journal-photo]");
      if (removeJournalPhoto) {
        pendingJournalImages = pendingJournalImages.filter((image) => image.id !== removeJournalPhoto.dataset.removeJournalPhoto);
        refreshJournalPhotoSelection();
        return;
      }

      const deleteJournal = event.target.closest("[data-delete-journal-entry]");
      if (deleteJournal) {
        deleteJournalEntry(deleteJournal.dataset.deleteJournalEntry);
        return;
      }

      const journalPhoto = event.target.closest("[data-journal-image-id]");
      if (journalPhoto) {
        openJournalImage(journalPhoto.dataset.journalImageId);
        return;
      }

      const action = event.target.closest("[data-action]");
      if (action) {
        event.preventDefault();
        handleAction(action.dataset.action, action);
        return;
      }

      const tripElement = event.target.closest("[data-open-trip]");
      if (tripElement) {
        openTrip(tripElement.dataset.openTrip);
        return;
      }

      const templateElement = event.target.closest("[data-open-template]");
      if (templateElement) {
        openTemplate(templateElement.dataset.openTemplate);
        return;
      }

      const templateChoice = event.target.closest("[data-select-template]");
      if (templateChoice) {
        const form = templateChoice.closest("form");
        const hidden = form?.querySelector('input[name="templateId"]');
        if (hidden) hidden.value = templateChoice.dataset.selectTemplate;
        templateChoice.closest(".template-choice-grid")?.querySelectorAll(".template-choice").forEach((button) => button.classList.remove("is-selected"));
        templateChoice.classList.add("is-selected");
        return;
      }

      const checkbox = event.target.closest("[data-check-item]");
      if (checkbox && !event.target.closest("[data-edit-trip-item]")) {
        const trip = currentProfile().trips.find((entry) => entry.id === currentTripId);
        const category = trip?.categories.find((entry) => entry.id === checkbox.dataset.categoryId);
        const item = category?.items.find((entry) => entry.id === checkbox.dataset.checkItem);
        if (item) {
          item.checked = !item.checked;
          saveStore({ quiet: true });
          renderTripDetail();
          renderDashboard();
          renderTrips();
        }
        return;
      }

      const templateCheckbox = event.target.closest("[data-template-check-item]");
      if (templateCheckbox && !event.target.closest("[data-action]")) {
        const template = currentProfile().templates.find((entry) => entry.id === currentTemplateId);
        const category = template?.categories.find((entry) => entry.id === templateCheckbox.dataset.categoryId);
        const item = category?.items.find((entry) => entry.id === templateCheckbox.dataset.templateCheckItem);
        if (item) {
          item.checked = !item.checked;
          saveStore({ quiet: true });
          renderTemplateDetail();
        }
        return;
      }

      const editItem = event.target.closest("[data-edit-trip-item]");
      if (editItem) {
        event.stopPropagation();
        openItemModal({ mode: "edit", categoryId: editItem.dataset.categoryId, itemId: editItem.dataset.editTripItem });
        return;
      }

      const addItem = event.target.closest("[data-add-trip-item]");
      if (addItem) {
        openItemModal({ mode: "add", categoryId: addItem.dataset.addTripItem });
        return;
      }

      const toggleCategory = event.target.closest("[data-toggle-category]");
      if (toggleCategory) {
        const id = toggleCategory.dataset.toggleCategory;
        if (collapsedCategories.has(id)) collapsedCategories.delete(id);
        else collapsedCategories.add(id);
        const group = toggleCategory.closest(".category-group");
        group?.classList.toggle("is-collapsed", collapsedCategories.has(id));
        toggleCategory.setAttribute("aria-expanded", String(!collapsedCategories.has(id)));
        return;
      }

      const shareTab = event.target.closest("[data-share-tab]");
      if (shareTab) {
        document.querySelectorAll("[data-share-tab]").forEach((button) => button.classList.toggle("is-active", button === shareTab));
        document.querySelectorAll("[data-share-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.sharePanel === shareTab.dataset.shareTab));
        return;
      }

      const copyCode = event.target.closest("[data-copy-code]");
      if (copyCode) {
        copyText(copyCode.dataset.copyCode);
        return;
      }

      const importShareButton = event.target.closest("[data-import-share]");
      if (importShareButton) {
        importShare(importShareButton.dataset.importShare, importShareButton.dataset.ownerId);
        return;
      }

      const deleteReminder = event.target.closest("[data-delete-reminder]");
      if (deleteReminder) {
        const trip = currentProfile().trips.find((entry) => entry.id === currentTripId);
        if (trip) {
          trip.reminders = trip.reminders.filter((reminder) => reminder.id !== deleteReminder.dataset.deleteReminder);
          saveStore();
          closeModal();
          renderAll();
          showToast("提醒已删除");
          openReminderModal(trip.id);
        }
        return;
      }

      const revokeShare = event.target.closest("[data-revoke-share]");
      if (revokeShare) {
        const share = currentProfile().shares.find((entry) => entry.id === revokeShare.dataset.revokeShare);
        if (share) {
          share.active = false;
          share.revokedAt = new Date().toISOString();
          saveStore();
          closeModal();
          renderAll();
          showToast("分享授权已撤销");
        }
        return;
      }

      if (event.target === dom.backdrop) closeModal();
    });

    document.addEventListener("submit", (event) => {
      if (!dom.modal.contains(event.target)) return;
      event.preventDefault();
      modalSubmitHandler?.(event.target);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !dom.backdrop.hidden) {
        event.preventDefault();
        closeModal();
        return;
      }
      const tripElement = event.target.closest?.("[data-open-trip]");
      const templateElement = event.target.closest?.("[data-open-template]");
      if (event.key === "Enter" && (tripElement || templateElement)) {
        event.preventDefault();
        if (tripElement) openTrip(tripElement.dataset.openTrip);
        else openTemplate(templateElement.dataset.openTemplate);
      }
      const checkbox = event.target.closest?.("[data-check-item], [data-template-check-item]");
      if ((event.key === " " || event.key === "Enter") && checkbox) {
        event.preventDefault();
        checkbox.click();
      }
    });

    document.getElementById("tripSearch").addEventListener("input", (event) => {
      tripSearch = event.target.value;
      renderTrips();
    });
    document.getElementById("templateSearch").addEventListener("input", (event) => {
      templateSearch = event.target.value;
      renderTemplates();
    });
    document.getElementById("tripFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-trip-filter]");
      if (!button) return;
      tripFilter = button.dataset.tripFilter;
      renderTrips();
    });
    document.getElementById("continueTrip").addEventListener("click", (event) => {
      const tripId = event.currentTarget.dataset.tripId;
      if (tripId) openTrip(tripId);
    });
    document.getElementById("profileMini").addEventListener("click", openProfilesModal);
    document.getElementById("browserNotifyToggle").addEventListener("change", (event) => toggleSetting("browserNotify", event.target.checked));
    document.getElementById("inAppNotifyToggle").addEventListener("change", (event) => toggleSetting("inAppNotify", event.target.checked));
    dom.journalPhotoInput.addEventListener("change", (event) => {
      handleJournalPhotoSelection(event.target.files);
      event.target.value = "";
    });
    dom.importFile.addEventListener("change", (event) => {
      previewImport(event.target.files?.[0]);
      event.target.value = "";
    });

    document.addEventListener("input", (event) => {
      if (event.target.id !== "journalEntryText") return;
      journalDraftTripId = currentTripId;
      journalDraftText = event.target.value;
    });

    window.addEventListener("online", () => updateNetworkStatus(true));
    window.addEventListener("offline", () => updateNetworkStatus(false));

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", () => {
        const hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!hadController) return;
          const refreshKey = `shoushi-sw-refreshed-${BUILD_VERSION}`;
          if (sessionStorage.getItem(refreshKey)) return;
          sessionStorage.setItem(refreshKey, "1");
          window.location.reload();
        });
        navigator.serviceWorker.register(`./sw.js?v=${BUILD_VERSION}`, { updateViaCache: "none" })
          .then((registration) => registration.update())
          .catch((error) => console.warn("离线支持注册失败", error));
      });
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast("已复制到剪贴板");
  }

  function updateNetworkStatus(isOnline, initial = false) {
    dom.offlineBanner.classList.toggle("is-visible", !isOnline);
    document.querySelectorAll(".online-dot").forEach((dot) => dot.classList.toggle("is-offline", !isOnline));
    const syncStatus = document.getElementById("syncStatus");
    if (syncStatus) syncStatus.textContent = isOnline ? "所有更改已保存" : "已保存到本机";
    if (isOnline && !initial) showToast("网络已恢复，数据仍保存在本机");
    if (isOnline) setTimeout(() => { saveStore({ quiet: true }); renderSettings(); }, 500);
  }

  function addSettingsProfileActions() {
    const card = document.querySelector(".settings-main .settings-card");
    if (!card || card.querySelector('[data-action="rename-profile"]')) return;
    const actions = document.createElement("div");
    actions.innerHTML = `
      <button class="settings-row action-row" type="button" data-action="rename-profile">
        <span><strong>重命名当前资料档</strong><small>修改后不会影响其他资料档</small></span>
        ${icon("i-edit")}
      </button>
      <button class="settings-row action-row danger-row" type="button" data-action="delete-profile">
        <span><strong>删除当前资料档</strong><small>至少保留一个本地资料档</small></span>
        ${icon("i-trash")}
      </button>
      <button class="settings-row action-row" type="button" data-action="revoke-shares">
        <span><strong>管理分享授权</strong><small>查看、撤销或重新生成好友码</small></span>
        ${icon("i-share")}
      </button>
    `;
    card.append(actions);
  }

  function init() {
    bindEvents();
    addSettingsProfileActions();
    try {
      if (!localStorage.getItem(STORAGE_KEY)) saveStore({ quiet: true });
    } catch {
      // The application remains usable for this session when storage is restricted.
    }
    renderAll();
    updateNetworkStatus(navigator.onLine, true);
    scheduleReminders();
    setInterval(() => {
      const time = document.getElementById("syncTime");
      if (time) time.textContent = formatShortTime(store.lastSavedAt);
    }, 60000);
  }

  init();
})();
