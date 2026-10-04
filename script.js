/* =========================================================
   DAFTARI
   Local-only personal life organizer
   Rewritten to match the current index.html structure
========================================================= */

"use strict";

/* =========================================================
   STORAGE
========================================================= */

const STORAGE_KEY = "daftari_v2";
const THEME_KEY = "daftari_theme";

const DEFAULT_MONTH_SETTINGS = {
    loan: 425000,
    fuelBudget: 200000,
    mobileInternet: 40000,

    homeContribution: 550000,
    norhanContribution: 550000,

    generator: 100000,
    homeInternet: 35000,
    rent: 650000
};

const MONTH_NAMES = [
    "كانون الثاني",
    "شباط",
    "آذار",
    "نيسان",
    "أيار",
    "حزيران",
    "تموز",
    "آب",
    "أيلول",
    "تشرين الأول",
    "تشرين الثاني",
    "كانون الأول"
];

const FUEL_PRICES = {
    normal: 450,
    premium: 850
};

const FUEL_TYPE_LABELS = {
    normal: "عادي",
    premium: "محسن",
    other: "آخر"
};

/*
    الزيوت والفلاتر والبطارية (car parts)

    كل نوع يحفظ سجله داخل month.carExpenses بنفس بنية سجلات
    السيارة (kind / title / amount / date) مع حقول إضافية:

        oil      -> itemType + quantity (لتر)
        filter   -> itemType
        battery  -> itemType
*/

const CAR_PART_TYPES = {
    oil: {
        kind: "oil",
        label: "الزيوت",
        icon: "🛢️",
        title: "تغيير زيت",
        typeLabel: "نوع الزيت",
        quantity: true,
        quantityLabel: "الكمية (لتر)",
        unit: "لتر",
        typeOptions: [
            "زيت محرك 10W-30",
            "زيت محرك 10W-40",
            "زيت محرك 5W-30",
            "زيت محرك 20W-50",
            "زيت جير",
            "زيت فرامل"
        ]
    },

    filter: {
        kind: "filter",
        label: "الفلاتر",
        icon: "🔧",
        title: "تغيير فلتر",
        typeLabel: "نوع الفلتر",
        quantity: false,
        quantityLabel: "",
        unit: "",
        typeOptions: [
            "فلتر زيت",
            "فلتر هواء",
            "فلتر بنزين",
            "فلتر مكيف",
            "فلتر ديزل"
        ]
    },

    battery: {
        kind: "battery",
        label: "البطارية",
        icon: "🔋",
        title: "تغيير بطارية",
        typeLabel: "نوع البطارية",
        quantity: false,
        quantityLabel: "",
        unit: "",
        typeOptions: [
            "بطارية 60 أمبير",
            "بطارية 70 أمبير",
            "بطارية 80 أمبير",
            "بطارية 100 أمبير",
            "بطارية سائلة",
            "بطارية دراي"
        ]
    }
};

const WEEKDAY_NAMES = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت"
];

/* =========================================================
   APP STATE
========================================================= */

const now = new Date();

let currentYear = now.getFullYear();
let currentMonth = now.getMonth();

let activePage = "homePage";
let toastTimer = null;

/* =========================================================
   DOM HELPERS
========================================================= */

function $(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent = value;
    }
}

function formatNumber(value) {
    const number = Number(value) || 0;

    return number.toLocaleString("en-US");
}

function currency(value) {
    return `${formatNumber(value)} د.ع`;
}

/*
    Money text helpers (display only).
    Inputs show thousands separators while typing, but every value that
    reaches the calculations / localStorage / Firestore is a plain number.
*/

function normalizeNumberText(value) {
    return String(value ?? "")
        .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
        .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
        .replace(/[,،٬\s]/g, "")
        .replace(/٫/g, ".");
}

function numberValue(value) {
    const number = typeof value === "string"
        ? Number(normalizeNumberText(value))
        : Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return 0;
    }

    return Math.round(number);
}

function parseDecimal(value) {
    const number = parseFloat(
        typeof value === "string"
            ? normalizeNumberText(value)
            : String(value ?? "")
    );

    if (!Number.isFinite(number) || number < 0) {
        return 0;
    }

    return number;
}

/* "1250000" -> "1,250,000" (digits only; "" stays "") */
function formatMoneyDigits(digits) {
    const clean = String(digits ?? "")
        .replace(/\D/g, "")
        .replace(/^0+(?=\d)/, "");

    return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* number -> text for an input's value ("" when empty) */
function moneyInputValue(value) {
    const number = numberValue(value);

    return number > 0 ? formatMoneyDigits(String(number)) : "";
}

/* Re-formats a money <input> in place and keeps the caret where it was. */
function formatMoneyInput(input) {
    if (!input || typeof input.value !== "string") {
        return;
    }

    const raw = input.value;

    let caret = raw.length;

    try {
        if (typeof input.selectionStart === "number") {
            caret = input.selectionStart;
        }
    } catch (error) {
        caret = raw.length;
    }

    const digitsBeforeCaret = normalizeNumberText(raw.slice(0, caret))
        .replace(/\D/g, "").length;

    const formatted = formatMoneyDigits(normalizeNumberText(raw));

    if (formatted === raw) {
        return;
    }

    input.value = formatted;

    let position = 0;
    let seen = 0;

    while (position < formatted.length && seen < digitsBeforeCaret) {
        if (/\d/.test(formatted[position])) {
            seen += 1;
        }

        position += 1;
    }

    try {
        input.setSelectionRange(position, position);
    } catch (error) {
        /* some input types do not support selection */
    }
}

function setupMoneyInputs() {
    document.addEventListener(
        "input",
        (event) => {

            const target = event && event.target;

            if (
                target &&
                typeof target.matches === "function" &&
                target.matches("input[data-money]")
            ) {
                formatMoneyInput(target);
            }

        }
    );
}

function roundDecimals(value, decimals) {
    const number = parseDecimal(value);
    const factor = Math.pow(10, decimals);

    return Math.round(number * factor) / factor;
}

function formatDecimals(value, decimals) {
    const number = roundDecimals(value, decimals);

    return number.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    });
}

function monthKey(year = currentYear, month = currentMonth) {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/* =========================================================
   DATABASE
========================================================= */

function createMonth(year, month) {
    return {
        year,
        month,

        settings: {
            ...DEFAULT_MONTH_SETTINGS
        },

        savings: null,

        expenses: [],

        carExpenses: [],

        homeExpenses: []
    };
}

function loadDatabase() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            return { months: {} };
        }

        const database = JSON.parse(saved);

        if (!database || typeof database !== "object") {
            return { months: {} };
        }

        if (!database.months || typeof database.months !== "object") {
            database.months = {};
        }

        return database;

    } catch (error) {
        console.error("Daftari storage error:", error);

        return { months: {} };
    }
}

function saveDatabase() {
    /*
        Cloud hook first: it may refresh car sync timestamps so
        that the localStorage snapshot below already contains them.
    */

    if (typeof DaftariSync !== "undefined" && DaftariSync) {
        try {
            DaftariSync.onLocalSave();

        } catch (error) {
            console.error("[Daftari] onLocalSave failed:", error);
        }
    }

    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(database)
        );

    } catch (error) {
        console.error("[Daftari] localStorage save failed:", error);
    }
}

let database = loadDatabase();

function ensureCurrentMonth() {
    const key = monthKey();

    if (!database.months[key]) {
        database.months[key] = createMonth(currentYear, currentMonth);
    }

    const month = database.months[key];

    month.year = currentYear;
    month.month = currentMonth;

    month.settings = {
        ...DEFAULT_MONTH_SETTINGS,
        ...(month.settings || {})
    };

    if (!Array.isArray(month.expenses)) {
        month.expenses = [];
    }

    if (!Array.isArray(month.carExpenses)) {
        month.carExpenses = [];
    }

    if (!Array.isArray(month.homeExpenses)) {
        month.homeExpenses = [];
    }

    return month;
}

function currentMonthData() {
    return ensureCurrentMonth();
}

function commit() {
    saveDatabase();
    renderAll();
}

/* =========================================================
   THEME
========================================================= */

function applyTheme(theme) {
    document.body.classList.toggle(
        "dark",
        theme === "dark"
    );

    const button = $("themeButton");

    if (button) {
        button.textContent = theme === "dark" ? "☀" : "☾";
    }
}

function loadTheme() {
    let theme = "light";

    try {
        theme = localStorage.getItem(THEME_KEY) || "light";

    } catch (error) {
        console.error("Daftari theme error:", error);
    }

    applyTheme(theme);
}

function toggleTheme() {
    const isDark = document.body.classList.contains("dark");

    const theme = isDark ? "light" : "dark";

    applyTheme(theme);

    try {
        localStorage.setItem(THEME_KEY, theme);

    } catch (error) {
        console.error("Daftari theme save error:", error);
    }
}

/* =========================================================
   HEADER / MONTH NAVIGATION
========================================================= */

function updateMonthHeader() {
    const dateText =
        `${WEEKDAY_NAMES[now.getDay()]} ` +
        `${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

    setText("currentDate", dateText);
    setText("monthName", `${MONTH_NAMES[currentMonth]} ${currentYear}`);

    updateMonthLock();

    updatePreviousMonthUnlock();
}

/* =========================================================
   MONTH LOCK
   Previous months become read-only.
   Records can be edited/deleted only via long-press (~2s).
========================================================= */

const LONG_PRESS_DURATION = 2000;

/*
    Central month-lock state - compares YEAR + MONTH against today:

        past months    (before today's year/month) -> CLOSED (true)
        current month                             -> OPEN   (false)
        future months                             -> OPEN   (false)

    Example (today = 23/09/2026):
        Jan 2026 .. Aug 2026 -> closed
        Sep 2026             -> open
        Oct 2026 .. Dec 2026 -> open
        Jan 2027             -> open

    This is the single source of truth used by every lock check.
*/

/* مفتاح الشهر السابق للشهر الحقيقي الحالي: YYYY-MM */
function previousMonthKey() {
    const today = new Date();

    const date = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1
    );

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getUnlockedMonths() {
    if (!Array.isArray(database.unlockedMonths)) {
        database.unlockedMonths = [];
    }

    return database.unlockedMonths.filter(
        (key) => typeof key === "string" && key
    );
}

/*
    فقط الشهر السابق مباشرة هو القابل للفتح.

    الفتح صالح لذلك الشهر بالذات، لذلك:
      - لا يمكن التخطي (أكتوبر لا يفتح أغسطس)
      - الأشهر الأقدم تُقفل تلقائياً مع مرور الوقت
      - الشهر الحالي والمستقبل مفتوحان دائماً بلا استثناء
*/
function isMonthUnlocked(year = currentYear, month = currentMonth) {
    const key = monthKey(year, month);

    if (key !== previousMonthKey()) {
        return false;
    }

    return getUnlockedMonths().indexOf(key) !== -1;
}

function isMonthClosed(year = currentYear, month = currentMonth) {
    const today = new Date();

    const beforeToday =
        year < today.getFullYear() ||
        (year === today.getFullYear() && month < today.getMonth());

    if (!beforeToday) {
        return false;
    }

    return !isMonthUnlocked(year, month);
}

function updateMonthLock() {
    const lock = $("monthLock");

    if (!lock) {
        return;
    }

    lock.classList.toggle(
        "hidden",
        !isMonthClosed()
    );
}

/*
    شريط الشهر السابق (أعلى التطبيق).

    حالة الشهر السابق + زر الفتح. يظهر مرة واحدة فقط في الأعلى،
    وليس داخل أي قسم.
*/
function updatePreviousMonthUnlock() {
    const text = $("previousMonthUnlockText");
    const button = $("unlockPreviousMonthButton");

    if (!text && !button) {
        return;
    }

    const key = previousMonthKey();
    const parts = key.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;

    const label = `${MONTH_NAMES[month]} ${year}`;

    if (isMonthUnlocked(year, month)) {
        setText(
            "previousMonthUnlockText",
            `🔓 ${label} مفتوح للتعديل`
        );

        button?.classList.add("hidden");
        return;
    }

    setText("previousMonthUnlockText", `🔒 ${label} مغلق للتعديل`);

    setText("unlockPreviousMonthButton", `فتح ${label}`);

    button?.classList.remove("hidden");
}

/*
    فتح قفل الشهر السابق مباشرة والانتقال إليه.

    يغيّر حالة القفل فقط - لا يمس أي بيانات، فتبقى كل بيانات
    ذلك الشهر كما هي وتصبح قابلة للتعديل طبيعياً.
*/
function unlockPreviousMonth() {
    const key = previousMonthKey();
    const parts = key.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;

    if (isMonthUnlocked(year, month)) {
        return;
    }

    const unlocked = getUnlockedMonths();

    if (unlocked.indexOf(key) === -1) {
        unlocked.push(key);
    }

    database.unlockedMonths = unlocked;

    currentYear = year;
    currentMonth = month;

    ensureCurrentMonth();
    updateMonthHeader();
    renderAll();
    saveDatabase();

    showToast(`🔓 ${MONTH_NAMES[month]} ${year} مفتوح للتعديل`);
}

/*
    Attaches long-press behavior to a rendered record row.

    - locked month  : normal click does nothing (with a hint toast);
                      press-and-hold ~2s shows a visual progress and
                      then opens the action sheet (edit / delete).
    - current month : single click triggers the action directly.
*/
function attachRecordPress(row, onAction) {
    if (!row) {
        return;
    }

    if (!isMonthClosed()) {
        row.addEventListener("click", onAction);
        return;
    }

    row.classList.add("locked-record");

    let pressTimer = null;
    let longPressDone = false;
    let startX = 0;
    let startY = 0;

    const clearProgress = () => {
        row.classList.remove("long-pressing");
    };

    const cancelPress = () => {

        if (longPressDone) {
            return;
        }

        clearTimeout(pressTimer);
        pressTimer = null;
        clearProgress();

    };

    row.addEventListener(
        "pointerdown",
        (event) => {

            if (event.button && event.button !== 0) {
                return;
            }

            longPressDone = false;

            startX = event.clientX;
            startY = event.clientY;

            clearProgress();

            row.classList.add("long-pressing");

            pressTimer = setTimeout(
                () => {

                    pressTimer = null;

                    longPressDone = true;

                    clearProgress();

                    onAction();

                },
                LONG_PRESS_DURATION
            );

        }
    );

    row.addEventListener(
        "pointermove",
        (event) => {

            if (!pressTimer) {
                return;
            }

            const moved =
                Math.abs(event.clientX - startX) > 12 ||
                Math.abs(event.clientY - startY) > 12;

            if (moved) {
                cancelPress();
            }

        }
    );

    row.addEventListener("pointerup", cancelPress);
    row.addEventListener("pointercancel", cancelPress);
    row.addEventListener("pointerleave", cancelPress);

    row.addEventListener(
        "click",
        (event) => {

            event.preventDefault();
            event.stopImmediatePropagation();

            if (longPressDone) {
                longPressDone = false;
                return;
            }

            showToast("🔒 شهر مغلق — اضغط مطولاً على العملية للتعديل");

        }
    );
}

function setupMonthNavigation() {
    $("previousMonth")?.addEventListener(
        "click",
        () => {

            currentMonth--;

            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }

            ensureCurrentMonth();
            updateMonthHeader();
            renderAll();

        }
    );

    $("nextMonth")?.addEventListener(
        "click",
        () => {

            currentMonth++;

            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }

            ensureCurrentMonth();
            updateMonthHeader();
            renderAll();

        }
    );

    $("unlockPreviousMonthButton")?.addEventListener(
        "click",
        unlockPreviousMonth
    );
}

/* =========================================================
   NAVIGATION
========================================================= */

function showPage(pageId) {
    activePage = pageId;

    document
        .querySelectorAll(".page")
        .forEach((page) => {

            page.classList.toggle(
                "active",
                page.id === pageId
            );

        });

    document
        .querySelectorAll(".nav-item")
        .forEach((item) => {

            item.classList.toggle(
                "active",
                item.dataset.page === pageId
            );

        });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function setupNavigation() {
    document
        .querySelectorAll("[data-page]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {
                    showPage(button.dataset.page);
                }
            );

        });
}

/* =========================================================
   MODAL / TOAST
========================================================= */

function openModal(html) {
    const modal = $("modal");
    const content = $("modalContent");

    if (!modal || !content) {
        return;
    }

    content.innerHTML = html;

    modal.classList.remove("hidden");
}

function closeModal() {
    $("modal")?.classList.add("hidden");
}

/*
    نافذة تأكيد صغيرة (إلغاء / تأكيد) بنفس أسلوب نوافذ التطبيق.
    تُستخدم قبل الحذف حتى لا يفقد المستخدم حركة بلمسة واحدة.
*/
function openConfirmDialog({
    title,
    message = "",
    confirmLabel = "تأكيد",
    onConfirm
}) {
    openModal(`
        <h2 class="modal-title">${title}</h2>

        ${message ? `<p class="modal-hint">${message}</p>` : ""}

        <div class="confirm-actions">

            <button
                type="button"
                class="confirm-btn confirm-cancel"
                id="confirmCancelButton"
            >
                إلغاء
            </button>

            <button
                type="button"
                class="confirm-btn confirm-accept"
                id="confirmAcceptButton"
            >
                ${confirmLabel}
            </button>

        </div>
    `);

    $("confirmCancelButton")?.addEventListener("click", closeModal);

    $("confirmAcceptButton")?.addEventListener(
        "click",
        () => {

            closeModal();

            onConfirm();

        }
    );
}

function setupModal() {
    $("modalClose")?.addEventListener("click", closeModal);

    $("modalOverlay")?.addEventListener("click", closeModal);

    document.addEventListener(
        "keydown",
        (event) => {

            if (event.key === "Escape") {
                closeModal();
            }

        }
    );
}

function showToast(message) {
    const toast = $("toast");

    if (!toast) {
        return;
    }

    toast.textContent = message;

    toast.classList.remove("hidden");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(
        () => {
            toast.classList.add("hidden");
        },
        2600
    );
}

/* =========================================================
   MODAL FORM TEMPLATES
========================================================= */

function amountFormHtml({ title, label, value = "", submitLabel = "حفظ", hint = "" }) {
    return `
        <h2 class="modal-title">${title}</h2>

        ${hint ? `<p class="modal-hint">${hint}</p>` : ""}

        <form id="genericForm">

            <div class="form-group">

                <label for="genericAmount">
                    ${label}
                </label>

                <input
                    type="text"
                    id="genericAmount"

                    inputmode="numeric"
                    value="${value === "" ? "" : moneyInputValue(value)}"
                    required

                    data-money
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                ${submitLabel}
            </button>

        </form>
    `;
}

function expenseFormHtml({ title, label, withSavingsOption = false }) {
    return `
        <h2 class="modal-title">${title}</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericTitle">
                    ${label}
                </label>

                <input
                    type="text"
                    id="genericTitle"
                    placeholder="مثال: مصروف الطريق"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericAmount">
                    المبلغ (د.ع)
                </label>

                <input
                    type="text"
                    id="genericAmount"

                    inputmode="numeric"
                    required

                    data-money
                >

            </div>

            ${withSavingsOption ? `
            <div class="form-group savings-choice">

                <label class="choice-label">
                    <input
                        type="checkbox"
                        id="genericIsSavings"
                    >

                    <span>
                        💰 هذا المبلغ ادخار (يُضاف إلى رصيد الادخار)
                    </span>

                </label>

            </div>
            ` : ""}

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
    `;
}

function bindGenericForm(onSubmit, { allowZero = false } = {}) {
    const form = $("genericForm");

    if (!form) {
        return;
    }

    form.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const amount = numberValue($("genericAmount")?.value);

            if (amount < 0 || (!allowZero && amount <= 0)) {
                showToast("أدخل مبلغاً صحيحاً");
                return;
            }

            const title = $("genericTitle")?.value?.trim() || "";

            onSubmit(amount, title);

        }
    );
}

/* =========================================================
   ACTIONS (edit settings / savings / add expenses)
========================================================= */

const EDITABLE_SETTINGS = {
    salary: "الراتب الشهري",
    loan: "السلفة",
    fuelBudget: "ميزانية البنزين",
    mobileInternet: "نت الموبايل",
    homeContribution: "مصرف البيت",
    generator: "المولد",
    homeInternet: "نت البيت",
    rent: "الإيجار"
};

/*
    Monthly salary: a month that never set its own salary follows the
    latest earlier month that did (nothing is copied or stored until the
    user edits it).
*/

function getSalary(month) {
    const own = month.settings && month.settings.salary;

    if (typeof own === "number" && isFinite(own)) {
        return own;
    }

    const thisKey = monthKey(month.year, month.month);

    const earlier = Object.keys(database.months)
        .filter((key) => key < thisKey)
        .sort()
        .reverse();

    for (const key of earlier) {
        const value = database.months[key]?.settings?.salary;

        if (typeof value === "number" && isFinite(value)) {
            return value;
        }
    }

    return 0;
}

function openEditSettingModal(key) {
    const month = currentMonthData();

    const label = EDITABLE_SETTINGS[key];

    if (!label) {
        return;
    }

    openModal(
        amountFormHtml({
            title: `تعديل ${label}`,
            label: `${label} (د.ع)`,
            value: key === "salary"
                ? getSalary(month)
                : numberValue(month.settings[key])
        })
    );

    bindGenericForm(
        (amount) => {

            month.settings[key] = amount;

            commit();
            closeModal();
            showToast("تم الحفظ");

        }
    );
}

/*
    تعديل الادخار من بطاقة «المصروفات الأساسية».

    يغيّر رقم الادخار المخصوم للشهر مرة واحدة فقط: يقارن القيمة
    الجديدة بالحالية ويسجّل الفرق حركة واحدة (إيداع أو سحب)،
    فلا تُحسب القيمة مرتين ولا تبقى معلّقة في الحقل القديم
    month.savings الذي كان يرحّله التطبيق إلى حركة إضافية.
*/
function openSavingModal() {
    const month = currentMonthData();

    const current = savingsReserved(month.year, month.month);

    /* تاريخ داخل الشهر المعروض حتى يعدّل الاستقطاع شهره لا شهر اليوم */
    const date = new Date(month.year, month.month, 1, 12).toISOString();

    openModal(
        amountFormHtml({
            title: "تعديل الادخار",
            label: "مبلغ الادخار المخصوم من المتبقي (د.ع)",
            value: current,
            hint: current > 0
                ? `مخصوم حالياً: ${currency(current)}`
                : "لا يوجد ادخار مخصوم من هذا الشهر"
        })
    );

    bindGenericForm(
        (amount) => {

            const delta = amount - current;

            if (delta > 0) {
                addSavingsTransaction({
                    type: "deposit",
                    amount: delta,
                    note: "تعديل الادخار من المصروفات الأساسية",
                    source: "basicExpensesCard",
                    date
                });
            } else if (delta < 0) {
                addSavingsTransaction({
                    type: "withdraw",
                    amount: Math.abs(delta),
                    note: "تعديل الادخار من المصروفات الأساسية",
                    source: "basicExpensesCard",
                    date
                });
            }

            /* لا نكتب month.savings أبداً حتى لا يرحّله التطبيق حركة زائدة */
            month.savings = null;

            commit();
            closeModal();

            showToast(
                delta === 0 ? "الادخار كما هو" : "تم تعديل الادخار"
            );

        },
        { allowZero: true }
    );
}

function openPersonalExpenseModal() {
    openModal(
        expenseFormHtml({
            title: "إضافة مصروف",
            label: "اسم المصروف",
            withSavingsOption: true
        })
    );

    bindGenericForm(
        (amount, title) => {

            const month = currentMonthData();

            const isSavings =
                $("genericIsSavings")?.checked === true;

            /*
                معرّف واحد يربط السجلين معاً:

                  month.expenses  ↔  savingsLedger.transactions

                فالمبلغ محفوظ مرة واحدة كمصروف ظاهر، ومرة واحدة
                كحركة ادخار - والمبلغ يُخصم من المتبقي مرة واحدة فقط
                عبر spentExpensesTotal() + savingsReserved().
            */
            const transactionId =
                Date.now() + Math.floor(Math.random() * 100000);

            const date = new Date().toISOString();

            month.expenses.push({
                id: transactionId,
                title: title || (isSavings ? "ادخار" : "مصروف"),
                amount,
                isSavings,
                transactionId: isSavings ? transactionId : null,
                date
            });

            if (isSavings) {
                addSavingsTransaction({
                    type: "deposit",
                    amount,
                    note: "المصروفات الشخصية",
                    source: "personalExpenses",
                    transactionId,
                    date
                });
            }

            commit();
            closeModal();

            showToast(
                isSavings
                    ? "تم حفظ الادخار وإضافته لسجل الحركات"
                    : "تمت إضافة المصروف"
            );

        }
    );
}

function openHomeExpenseModal() {
    openModal(
        expenseFormHtml({
            title: "إضافة مصروف بيت",
            label: "اسم المصروف"
        })
    );

    bindGenericForm(
        (amount, title) => {

            const month = currentMonthData();

            month.homeExpenses.push({
                id: Date.now(),
                title: title || "مصروف بيت",
                amount,
                date: new Date().toISOString()
            });

            commit();
            closeModal();
            showToast("تمت إضافة المصروف");

        }
    );
}

function openCarExpenseModal(kind) {
    const titles = {
        fuel: "بنزين",
        maintenance: "صيانة",
        oil: "زيت",
        filter: "فلتر",
        battery: "بطارية"
    };

    const label = titles[kind] || "مصروف سيارة";

    openModal(
        expenseFormHtml({
            title: `إضافة ${label}`,
            label: "الوصف (اختياري)"
        })
    );

    bindGenericForm(
        (amount, title) => {

            const month = currentMonthData();

            month.carExpenses.push({
                id: Date.now(),
                kind,
                title: title || label,
                amount,
                date: new Date().toISOString()
            });

            commit();
            closeModal();
            showToast(`تمت إضافة ${label}`);

        }
    );
}

/* =========================================================
    FUEL (بنزين) DETAILED RECORDS
    Stored per-month in month.carExpenses (kind === "fuel")
    with fuelType / pricePerLiter / liters / total. The `amount`
    field always equals the total price, so the existing budget
    math (fuelSpent, carTotal) keeps working unchanged.
========================================================= */

function fuelFormHtml() {
    return `
        <h2 class="modal-title">تعبئة بنزين</h2>

        <form id="fuelForm" class="fuel-form" autocomplete="off">

            <div class="form-group">

                <label for="fuelTypeSelect">
                    نوع البنزين
                </label>

                <select id="fuelTypeSelect">

                    <option value="normal">
                        عادي — 450 د.ع/لتر
                    </option>

                    <option value="premium">
                        محسن — 850 د.ع/لتر
                    </option>

                    <option value="other">
                        آخر
                    </option>

                </select>

            </div>

            <div class="form-row">

                <div class="form-group">

                    <label for="fuelLiters">
                        عدد اللترات
                    </label>

                    <input
                        type="number"
                        id="fuelLiters"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        autocomplete="off"
                    >

                </div>

                <div class="form-group">

                    <label for="fuelPricePerLiter">
                        سعر اللتر (د.ع)
                    </label>

                    <input
                        type="text"
                        id="fuelPricePerLiter"

                        placeholder="0"
                        autocomplete="off"

                        inputmode="numeric"

                        data-money
                    >

                </div>

            </div>

            <div class="form-group">

                <label for="fuelTotal">
                    السعر الإجمالي (د.ع)
                </label>

                <input
                    type="text"
                    id="fuelTotal"

                    placeholder="0"
                    autocomplete="off"

                    inputmode="numeric"

                    data-money
                >

            </div>

            <div class="form-group">

                <label for="fuelDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="fuelDate"
                    required
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                حفظ التعبئة
            </button>

        </form>
    `;
}

function todayDateInputValue() {
    const d = new Date();

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function openFuelModal() {
    if (isMonthClosed()) {
        showToast("🔒 شهر مغلق");
        return;
    }

    openModal(fuelFormHtml());

    const typeSelect = $("fuelTypeSelect");
    const dateInput = $("fuelDate");

    if (typeSelect) {
        typeSelect.value = "normal";
    }

    onFuelTypeChange();

    if (dateInput && !dateInput.value) {
        dateInput.value = todayDateInputValue();
    }

    bindFuelForm();
}

function onFuelTypeChange() {
    const type = $("fuelTypeSelect")?.value || "normal";

    const priceInput = $("fuelPricePerLiter");

    if (!priceInput) {
        return;
    }

    if (type === "other") {
        priceInput.disabled = false;
        priceInput.value = priceInput.value || "";
    } else {
        priceInput.disabled = true;
        priceInput.value = moneyInputValue(FUEL_PRICES[type]);
    }

    recomputeFuelTotal();
}

function fuelPricePerLiter() {
    return parseDecimal($("fuelPricePerLiter")?.value);
}

function recomputeFuelTotal() {
    const liters = parseDecimal($("fuelLiters")?.value);
    const price = fuelPricePerLiter();

    const totalInput = $("fuelTotal");

    if (!totalInput) {
        return;
    }

    if (liters > 0 && price > 0) {
        totalInput.value = moneyInputValue(Math.round(liters * price));
    } else if (liters <= 0) {
        totalInput.value = "";
    }
}

function recomputeFuelLiters() {
    const total = parseDecimal($("fuelTotal")?.value);
    const price = fuelPricePerLiter();

    const litersInput = $("fuelLiters");

    if (!litersInput) {
        return;
    }

    if (total > 0 && price > 0) {
        litersInput.value = roundDecimals(total / price, 2);
    } else if (total <= 0) {
        litersInput.value = "";
    }
}

function bindFuelForm() {
    $("fuelTypeSelect")?.addEventListener("change", onFuelTypeChange);

    $("fuelLiters")?.addEventListener("input", recomputeFuelTotal);

    $("fuelPricePerLiter")?.addEventListener("input", recomputeFuelTotal);

    $("fuelTotal")?.addEventListener("input", recomputeFuelLiters);

    $("fuelForm")?.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const type = $("fuelTypeSelect")?.value || "normal";

            const liters = parseDecimal($("fuelLiters")?.value);

            const price = fuelPricePerLiter();

            if (liters <= 0) {
                showToast("أدخل عدد اللترات");
                return;
            }

            if (price <= 0) {
                showToast("أدخل سعر اللتر");
                return;
            }

            const total = Math.round(liters * price);

            const month = currentMonthData();

            month.carExpenses.push({
                id: Date.now(),
                kind: "fuel",
                title: "تعبئة بنزين",
                amount: total,
                date: fuelDateISO(),
                note: "",
                fuelType: type,
                pricePerLiter: Math.round(price),
                liters: roundDecimals(liters, 2),
                total: total
            });

            commit();
            closeModal();
            showToast("تم حفظ تعبئة البنزين");
        }
    );
}

function fuelDateISO() {
    const value = $("fuelDate")?.value;

    if (!value) {
        return new Date().toISOString();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? new Date().toISOString()
        : date.toISOString();
}

function getFuelRecords() {
    return currentMonthData().carExpenses.filter(
        (item) => item.kind === "fuel"
    );
}

function fuelRecordRowHtml({ listName, record }) {
    const typeLabel =
        FUEL_TYPE_LABELS[record.fuelType] ||
        record.fuelType ||
        "بنزين";

    const liters = record.liters != null
        ? formatDecimals(record.liters, 2)
        : "";

    const price = record.pricePerLiter != null
        ? formatNumber(record.pricePerLiter)
        : "";

    return `
        <div class="record-row fuel-row">

            <span class="record-icon">
                ⛽
            </span>

            <div class="record-info">

                <strong>
                    تعبئة بنزين — ${typeLabel}
                </strong>

                <span class="fuel-meta">
                    ${formatDate(record.date)}
                    ${liters ? ` • ${liters} لتر` : ""}
                    ${price ? ` • ${price} د.ع/لتر` : ""}
                </span>

            </div>

            <strong class="record-amount">
                ${currency(record.amount)}
            </strong>

            <button
                type="button"
                class="delete-record"
                data-delete="${listName}"
                data-delete-id="${record.id}"
                aria-label="حذف"
            >
                ×
            </button>

        </div>
    `;
}

/* =========================================================
    CAR PARTS (الزيوت والفلاتر والبطارية) DETAILED RECORDS

    Stored per-month in month.carExpenses with
    kind === "oil" | "filter" | "battery".

    كل سجل يحمل نوعه وتاريخه (والكمية للزيوت) فيظهر داخل
    سجلات الشهر مع بقية مصاريف السيارة، وتبقى السجلات القديمة
    ظاهرة لأن التصفية تعتمد على kind فقط.
========================================================= */

function carPartMeta(kind) {
    if (!kind) {
        return null;
    }

    if (!Object.prototype.hasOwnProperty.call(CAR_PART_TYPES, kind)) {
        return null;
    }

    return CAR_PART_TYPES[kind];
}

function carPartFormHtml(kind) {
    const meta = carPartMeta(kind);

    if (!meta) {
        return "";
    }

    const typeOptions = meta.typeOptions
        .map((option) => `<option value="${option}"></option>`)
        .join("");

    return `
        <h2 class="modal-title">${meta.title}</h2>

        <form id="carPartForm" class="fuel-form" autocomplete="off">

            <div class="form-group">

                <label for="carPartType">
                    ${meta.typeLabel}
                </label>

                <input
                    type="text"
                    id="carPartType"
                    list="carPartTypeOptions"
                    placeholder="${meta.typeOptions[0]}"
                    autocomplete="off"
                    required
                >

                <datalist id="carPartTypeOptions">
                    ${typeOptions}
                </datalist>

            </div>

            ${meta.quantity ? `
            <div class="form-group">

                <label for="carPartQuantity">
                    ${meta.quantityLabel}
                </label>

                <input
                    type="number"
                    id="carPartQuantity"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    autocomplete="off"
                >

            </div>
            ` : ""}

            <div class="form-group">

                <label for="carPartAmount">
                    السعر (د.ع)
                </label>

                <input
                    type="text"
                    id="carPartAmount"

                    inputmode="numeric"
                    placeholder="0"
                    autocomplete="off"
                    required

                    data-money
                >

            </div>

            <div class="form-group">

                <label for="carPartNote">
                    ملاحظة (اختياري)
                </label>

                <input
                    type="text"
                    id="carPartNote"
                    placeholder="مثال: تغيير دوري"
                    autocomplete="off"
                >

            </div>

            <div class="form-group">

                <label for="carPartDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="carPartDate"
                    required
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
    `;
}

function openCarPartModal(kind) {
    const meta = carPartMeta(kind);

    if (!meta) {
        return;
    }

    if (isMonthClosed()) {
        showToast("🔒 شهر مغلق");
        return;
    }

    openModal(carPartFormHtml(kind));

    const dateInput = $("carPartDate");

    if (dateInput && !dateInput.value) {
        dateInput.value = todayDateInputValue();
    }

    bindCarPartForm(kind);
}

function carPartDateISO() {
    const value = $("carPartDate")?.value;

    if (!value) {
        return new Date().toISOString();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? new Date().toISOString()
        : date.toISOString();
}

function bindCarPartForm(kind) {
    const meta = carPartMeta(kind);

    if (!meta) {
        return;
    }

    $("carPartForm")?.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const itemType = String(
                $("carPartType")?.value || ""
            ).trim();

            const amount = numberValue($("carPartAmount")?.value);

            const quantity = meta.quantity
                ? roundDecimals(
                    parseDecimal($("carPartQuantity")?.value),
                    2
                )
                : 0;

            if (!itemType) {
                showToast(`أدخل ${meta.typeLabel}`);
                return;
            }

            if (meta.quantity && quantity <= 0) {
                showToast("أدخل الكمية");
                return;
            }

            if (amount <= 0) {
                showToast("أدخل السعر");
                return;
            }

            const record = {
                id: Date.now(),
                kind: meta.kind,
                title: `${meta.title} — ${itemType}`,
                amount,
                total: amount,
                date: carPartDateISO(),
                note: String($("carPartNote")?.value || "").trim(),
                itemType
            };

            if (meta.quantity) {
                record.quantity = quantity;
                record.unit = meta.unit;
            }

            const month = currentMonthData();

            month.carExpenses.push(record);

            commit();
            closeModal();
            showToast(`تم حفظ ${meta.title} — ${meta.label}`);
        }
    );
}

/*
    سجلات نوع واحد من قطع السيارة داخل الشهر الحالي.
    التصفية تعتمد على kind فقط، لذلك تبقى السجلات القديمة
    (زيت / فلتر / بطارية) ظاهرة ولا تُحذف.
*/
function getCarPartRecords(kind) {
    return currentMonthData().carExpenses.filter(
        (item) => item.kind === kind
    );
}

function carRecordTime(record) {
    const time = new Date(record?.date || 0).getTime();

    return Number.isNaN(time) ? 0 : time;
}

/* الأحدث أولاً - ترتيب ثابت عند تساوي التواريخ */
function sortCarRecordsDesc(records) {
    return records
        .map((record, index) => ({ record, index }))
        .sort((a, b) => {

            const diff = carRecordTime(b.record) - carRecordTime(a.record);

            return diff !== 0 ? diff : b.index - a.index;
        })
        .map((item) => item.record);
}

function carPartLastChangeText(kind) {
    const records = getCarPartRecords(kind);

    if (!records.length) {
        return "لا يوجد سجل بعد";
    }

    return formatDate(sortCarRecordsDesc(records)[0].date) ||
        "لا يوجد سجل بعد";
}

function carPartRecordRowHtml({ listName, record, kind }) {
    const meta = carPartMeta(kind) || CAR_PART_TYPES.oil;

    const typeLabel =
        record.itemType ||
        record.oilType ||
        record.filterType ||
        record.batteryType ||
        record.title ||
        meta.label;

    const quantity = record.quantity != null && record.quantity !== ""
        ? formatDecimals(record.quantity, 2)
        : "";

    const quantityText = quantity
        ? ` • ${quantity}${record.unit ? ` ${record.unit}` : ""}`
        : "";

    const noteText = record.note ? ` • ${record.note}` : "";

    return `
        <div class="record-row car-part-row">

            <span class="record-icon">
                ${meta.icon}
            </span>

            <div class="record-info">

                <strong>
                    ${meta.title} — ${typeLabel}
                </strong>

                <span class="fuel-meta">
                    ${formatDate(record.date)}${quantityText}${noteText}
                </span>

            </div>

            <strong class="record-amount">
                ${currency(record.amount)}
            </strong>

            <button
                type="button"
                class="delete-record"
                data-delete="${listName}"
                data-delete-id="${record.id}"
                aria-label="حذف"
            >
                ×
            </button>

        </div>
    `;
}

function setupActions() {
    $("themeButton")?.addEventListener("click", toggleTheme);

    $("setSavingButton")?.addEventListener("click", openSavingModal);

    $("addExpenseButton")?.addEventListener("click", openPersonalExpenseModal);

    $("addHomeExpenseButton")?.addEventListener("click", openHomeExpenseModal);

    $("carFuelButton")?.addEventListener(
        "click",
        openFuelModal
    );

    $("carMaintenanceButton")?.addEventListener(
        "click",
        () => openCarExpenseModal("maintenance")
    );

    $("carOilButton")?.addEventListener(
        "click",
        () => openCarPartModal("oil")
    );

    $("carFilterButton")?.addEventListener(
        "click",
        () => openCarPartModal("filter")
    );

    $("carBatteryButton")?.addEventListener(
        "click",
        () => openCarPartModal("battery")
    );

    $("walletDepositButton")?.addEventListener(
        "click",
        () => openWalletModal("deposit")
    );

    $("walletWithdrawButton")?.addEventListener(
        "click",
        () => openWalletModal("withdraw")
    );

    $("walletToggleButton")?.addEventListener(
        "click",
        toggleWalletCard
    );

    $("addGroceryButton")?.addEventListener(
        "click",
        openGroceryModal
    );

    $("accountButton")?.addEventListener(
        "click",
        openAccountModal
    );

    $("savingsDepositButton")?.addEventListener(
        "click",
        openDepositModal
    );

    $("savingsWithdrawButton")?.addEventListener(
        "click",
        openWithdrawModal
    );

    $("addDebtorButton")?.addEventListener(
        "click",
        openAddDebtorModal
    );

    $("addPersonalTaskButton")?.addEventListener(
        "click",
        () => openAddTaskModal("personalTasks", "إضافة مهمة شخصية")
    );

    $("addHomeTaskButton")?.addEventListener(
        "click",
        () => openAddTaskModal("homeTasks", "إضافة مهمة بيت")
    );

    document
        .querySelectorAll("[data-edit-setting]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {
                    openEditSettingModal(button.dataset.editSetting);
                }
            );

        });

    document.addEventListener(
        "click",
        (event) => {

            const deleteButton = event.target.closest("[data-delete]");

            if (deleteButton) {
                deleteRecord(
                    deleteButton.dataset.delete,
                    deleteButton.dataset.deleteId
                );
                return;
            }

            const groceryButton = event.target.closest("[data-grocery]");

            if (groceryButton) {
                openGroceryCategory(groceryButton.dataset.grocery);
                return;
            }

            const groceryTypeButton =
                event.target.closest("[data-grocery-type]");

            if (groceryTypeButton) {
                setGrocerySubtype(groceryTypeButton.dataset.groceryType);
                return;
            }

            const payButton = event.target.closest("[data-debtor-pay]");

            if (payButton) {
                openDebtorPaymentModal(payButton.dataset.debtorPay);
                return;
            }

            const debtorDeleteButton =
                event.target.closest("[data-debtor-delete]");

            if (debtorDeleteButton) {
                deleteDebtor(debtorDeleteButton.dataset.debtorDelete);
                return;
            }

            const savingsDeleteButton =
                event.target.closest("[data-savings-delete]");

            if (savingsDeleteButton) {
                deleteSavingsMovement(
                    savingsDeleteButton.dataset.savingsDelete
                );
                return;
            }

            const walletDeleteButton =
                event.target.closest("[data-wallet-delete]");

            if (walletDeleteButton) {
                deleteWalletMovement(
                    walletDeleteButton.dataset.walletDelete
                );
                return;
            }

            const taskToggleButton =
                event.target.closest("[data-task-toggle]");

            if (taskToggleButton) {
                toggleTask(taskToggleButton.dataset.taskToggle);
                return;
            }

            const taskEditButton =
                event.target.closest("[data-task-edit]");

            if (taskEditButton) {
                openEditTaskModal(taskEditButton.dataset.taskEdit);
                return;
            }

            const taskDeleteButton =
                event.target.closest("[data-task-delete]");

            if (taskDeleteButton) {
                requestDeleteTask(taskDeleteButton.dataset.taskDelete);
                return;
            }

            const taskStatButton =
                event.target.closest("[data-task-stat]");

            if (taskStatButton) {
                toggleTaskStat(taskStatButton.dataset.taskStat);
            }

        }
    );

}

/*
    حذف حركة الادخار المرتبطة بسجل أصلي (transactionId واحد).
    يُستخدم عند حذف المصروف المحوَّل للادخار حتى لا تبقى حركة
    يتيمة تخصم من المتبقي بلا سبب.
*/
function deleteLinkedSavingsMovement(transactionId) {
    const ledger = getSavingsLedger();

    ledger.transactions = ledger.transactions.filter(
        (transaction) => transaction.transactionId !== transactionId
    );
}

/*
    حذف حركة المحفظة المرتبطة بمصروف صرف (نفس المعرّف).
    يُستخدم عند حذف مصروف "صرف من المحفظة" من صفحة المصروفات،
    حتى يعود المبلغ للمحفظة ولا تبقى حركة يتيمة.
*/
function deleteLinkedWalletMovement(walletTransactionId) {
    const ledger = getSavingsLedger();

    ledger.walletTransactions = ledger.walletTransactions.filter(
        (transaction) => transaction.id !== walletTransactionId
    );
}

function deleteRecord(listName, recordId, force = false) {
    const month = currentMonthData();

    if (
        !force &&
        isMonthClosed(month.year, month.month)
    ) {
        showToast("🔒 شهر مغلق — استخدم الضغط المطول");
        return;
    }

    const id = Number(recordId);

    const removed = (month[listName] || []).find(
        (record) => record.id === id
    );

    month[listName] = month[listName].filter(
        (record) => record.id !== id
    );

    /* إن كان محوّلاً للادخار، تُحذف حركته المرتبطة معه */
    if (removed && removed.isSavings && removed.transactionId) {
        deleteLinkedSavingsMovement(removed.transactionId);
    }

    /* إن كان صرفاً من المحفظة، تُحذف حركته المرتبطة به أيضاً */
    if (removed && removed.walletTransactionId) {
        deleteLinkedWalletMovement(removed.walletTransactionId);
    }

    commit();
    showToast("تم الحذف");
}

/*
    After rendering record rows into a list container, this wires
    every row:

    - current month : delete button works normally.
    - locked month  : delete button is blocked; long-press (~2s)
                      on the row opens an action sheet that allows
                      deleting the record (bypasses the lock).
*/
function wireRecordRows(listElement, listName) {
    if (!listElement) {
        return;
    }

    if (!isMonthClosed()) {
        return;
    }

    Array.from(listElement.children).forEach((row) => {

        const deleteButton = row.querySelector("[data-delete]");

        if (!deleteButton) {
            return;
        }

        const recordId = deleteButton.dataset.deleteId;

        deleteButton.addEventListener(
            "click",
            (event) => {

                event.preventDefault();
                event.stopImmediatePropagation();

                showToast("🔒 شهر مغلق — اضغط مطولاً على العملية");

            },
            true
        );

        attachRecordPress(
            row,
            () => {

                openModal(
                    `
                    <h2 class="modal-title">تعديل عملية شهر مغلق</h2>

                    <p class="locked-hint">
                        🔒 هذا الشهر مغلق. يمكنك حذف هذه العملية فقط.
                    </p>

                    <button
                        type="button"
                        class="form-submit danger"
                        id="forceDeleteButton"
                    >
                        حذف العملية
                    </button>
                    `
                );

                $("forceDeleteButton")?.addEventListener(
                    "click",
                    () => {

                        closeModal();

                        deleteRecord(listName, recordId, true);

                    }
                );

            }
        );

    });
}

/* =========================================================
   SAVINGS & DEBTORS (permanent, same storage system)

   IMPORTANT: savings are a CONTINUOUS CUMULATIVE balance
   across ALL months, stored once at database level
   (database.savingsLedger). Months never reset it.

   Old per-month data (month.savingsAccount) is migrated
   automatically on load - nothing is deleted.
========================================================= */

/*
    Migrates old per-month savings accounts into the single
    cumulative ledger. Keeps original transaction dates.
*/
function migrateSavingsLedger() {

    if (!database.savingsLedger || typeof database.savingsLedger !== "object") {
        database.savingsLedger = {
            transactions: [],
            debtors: []
        };
    }

    if (!Array.isArray(database.savingsLedger.transactions)) {
        database.savingsLedger.transactions = [];
    }

    if (!Array.isArray(database.savingsLedger.debtors)) {
        database.savingsLedger.debtors = [];
    }

    Object.keys(database.months).forEach((key) => {

        const month = database.months[key];

        if (!month || typeof month !== "object") {
            return;
        }

        // Migrate old simple monthly savings value (month.savings)

        if (month.savings !== null && month.savings !== undefined) {

            const value = numberValue(month.savings);

            if (value > 0) {
                database.savingsLedger.transactions.push({
                    id: Date.now() + Math.floor(Math.random() * 100000),
                    type: "deposit",
                    amount: value,
                    note: "رصيد قديم (ترحيل تلقائي)",
                    date: new Date(
                        month.year,
                        month.month,
                        1,
                        12
                    ).toISOString()
                });
            }

            month.savings = null;

        }

        // Migrate old per-month savings account

        const account = month.savingsAccount;

        if (account && typeof account === "object") {

            if (Array.isArray(account.transactions)) {
                database.savingsLedger.transactions.push(
                    ...account.transactions
                );
            }

            if (Array.isArray(account.debtors)) {
                database.savingsLedger.debtors.push(
                    ...account.debtors
                );
            }

            delete month.savingsAccount;

        }

    });

    // Deduplicate by id (safe against repeated migrations)

    const seen = new Set();

    database.savingsLedger.transactions =
        database.savingsLedger.transactions.filter((transaction) => {

            if (!transaction || seen.has(transaction.id)) {
                return false;
            }

            seen.add(transaction.id);

            return true;

        });

    const debtorIds = new Set();

    database.savingsLedger.debtors =
        database.savingsLedger.debtors.filter((debtor) => {

            if (!debtor || debtorIds.has(debtor.id)) {
                return false;
            }

            debtorIds.add(debtor.id);

            return true;

        });

}

function getSavingsLedger() {
    return database.savingsLedger;
}

function savingsStats() {
    const ledger = getSavingsLedger();

    let deposits = 0;
    let withdrawals = 0;
    let fromExpenses = 0;

    ledger.transactions.forEach((transaction) => {

        const amount = numberValue(transaction.amount);

        if (transaction.type === "deposit") {
            deposits += amount;
        }

        if (transaction.type === "withdraw") {
            withdrawals += amount;
        }

        if (transaction.type === "fromExpenses") {
            fromExpenses += amount;
        }

    });

    // Cumulative balance across ALL months since the beginning

    const balance = deposits + fromExpenses - withdrawals;

    const debts = ledger.debtors.reduce(
        (total, debtor) =>
            total +
            Math.max(
                numberValue(debtor.required) - numberValue(debtor.paid),
                0
            ),
        0
    );

    return {
        deposits,
        withdrawals,
        fromExpenses,
        balance,
        debts,
        grandTotal: balance + debts
    };
}

function addSavingsTransaction({
    type,
    amount,
    note = "",
    date = null,
    source = null,
    transactionId = null
}) {
    const ledger = getSavingsLedger();

    const movement = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        type,
        amount: numberValue(amount),
        note,
        date: date || new Date().toISOString(),
        createdAt: new Date().toISOString()
    };

    /* مصدر العملية + المعرّف الذي يربطها بسجلها الأصلي */
    if (source) {
        movement.source = source;
    }

    if (transactionId) {
        movement.transactionId = transactionId;
    }

    ledger.transactions.push(movement);
}

function getSavingsBalance() {
    return savingsStats().balance;
}

/*
    Monthly savings report: groups cumulative-ledger
    transactions by their transaction date's month.
    The balance stays cumulative - this is a filter only.
*/
function savingsMonthlyReport(year, month) {
    const ledger = getSavingsLedger();

    let deposits = 0;
    let withdrawals = 0;
    let fromExpenses = 0;

    ledger.transactions.forEach((transaction) => {

        const date = new Date(transaction.date);

        if (
            Number.isNaN(date.getTime()) ||
            date.getFullYear() !== year ||
            date.getMonth() !== month
        ) {
            return;
        }

        const amount = numberValue(transaction.amount);

        if (transaction.type === "deposit") {
            deposits += amount;
        }

        if (transaction.type === "withdraw") {
            withdrawals += amount;
        }

        if (transaction.type === "fromExpenses") {
            fromExpenses += amount;
        }

    });

    return {
        deposits,
        withdrawals,
        fromExpenses,
        net: deposits + fromExpenses - withdrawals
    };
}

/*
    الادخار المخصوم من ميزانية شهر معيّن.

    تُحسب هنا مرة واحدة ويقرأها monthFinance() وحده، فلا يحصل
    خصم مزدوج مهما أُعيد رسم الصفحة أو أُعيد تحميلها.

    المحتسبة (تتحرّك من ميزانية الشخص):
      deposit       -> إيداع ادخار (من صفحة الادخار أو من
                       المصروفات الشخصية بعد ربط السجلين)
      fromExpenses  -> تحويلات قديمة من المصروفات (نفس المعالجة،
                       ومبلغها مستثنى من spentExpensesTotal)
      withdraw      -> يعود المبلغ إلى المتبقي
      debiorPayment مستثنى - ليس من ميزانية الشخص أصلاً.

    ولأن spentExpensesTotal() لا يحسب المصروفات المحوّلة للادخار،
    فإن أي مبلغ مرتبط هنا لا يُخصم مرتين.
*/
function savingsReserved(year = currentYear, month = currentMonth) {
    const report = savingsMonthlyReport(year, month);

    return report.net;
}

/* =========================================================
   PAGE TABS
========================================================= */

function setupPageTabs() {
    document
        .querySelectorAll(".page-tab")
        .forEach((tab) => {

            tab.addEventListener(
                "click",
                () => {

                    const tabsContainer = tab.closest(".page-tabs");

                    if (!tabsContainer) {
                        return;
                    }

                    tabsContainer
                        .querySelectorAll(".page-tab")
                        .forEach((item) => {

                            item.classList.toggle(
                                "active",
                                item === tab
                            );

                        });

                    const page = tab.closest(".page");

                    if (!page) {
                        return;
                    }

                    page
                        .querySelectorAll(".tab-panel")
                        .forEach((panel) => {

                            panel.classList.toggle(
                                "active",
                                panel.id === tab.dataset.tab
                            );

                        });

                }
            );

        });
}

/* =========================================================
   TASKS (personal + home)

   Stored per month in the same database:
       month.tasks = [{
           id, listKey, title, note,
           date, time, priority, category, status, done
       }]

   Backward compatibility:
   - Tasks created by older versions only carry
     { id, listKey, title, note, done, date }. Every new field is
     read with a safe default (priority = متوسطة, category = أخرى,
     status = جديدة / مكتملة حسب done) so old tasks never break.
   - Nothing is deleted or rewritten just by opening the page.
   - `done` stays in sync with `status` (completed) so both the old
     and the new shape remain valid.
========================================================= */

const TASK_LISTS = {
    personalTasks: {
        listId: "personalTasksList",
        toolbarId: "personalTasksToolbar",
        defaultCategory: "personal"
    },

    homeTasks: {
        listId: "homeTasksList",
        toolbarId: "homeTasksToolbar",
        defaultCategory: "home"
    }
};

const TASK_PRIORITIES = {
    low: { label: "منخفضة", order: 0 },
    medium: { label: "متوسطة", order: 1 },
    high: { label: "عالية", order: 2 },
    urgent: { label: "عاجلة", order: 3 }
};

const TASK_STATUSES = {
    new: { label: "جديدة" },
    inProgress: { label: "قيد التنفيذ" },
    completed: { label: "مكتملة" }
};

const TASK_CATEGORIES = {
    home: { label: "البيت", icon: "🏠" },
    work: { label: "العمل", icon: "💼" },
    car: { label: "السيارة", icon: "🚗" },
    personal: { label: "شخصي", icon: "👤" },
    shopping: { label: "مشتريات", icon: "🛒" },
    appointments: { label: "مواعيد", icon: "📅" },
    other: { label: "أخرى", icon: "📌" }
};

/* ---------------------------------------------------------
   RECURRENCE (تكرار المهمة)

   Stored on the task as an optional object:

       task.repeat = { mode, interval, unit, active }

   Legacy tasks have no `repeat` at all -> they behave exactly
   as before (no recurrence), and nothing is rewritten.
--------------------------------------------------------- */

const TASK_REPEAT_MODES = {
    daily: { label: "يوميًا" },
    weekly: { label: "أسبوعيًا" },
    monthly: { label: "شهريًا" },
    yearly: { label: "سنويًا" },
    custom: { label: "مخصص" }
};

const TASK_REPEAT_UNITS = {
    day: { label: "أيام" },
    week: { label: "أسابيع" },
    month: { label: "أشهر" }
};

/*
    Per-list view state. Display-only: it is never written to the
    saved database. Only the summary-card quick filter is kept.
*/

const taskViewStateStore = {};

function taskViewState(listKey) {
    if (!taskViewStateStore[listKey]) {
        taskViewStateStore[listKey] = {
            quick: "all"
        };
    }

    return taskViewStateStore[listKey];
}

function ensureTasks(month) {
    if (!Array.isArray(month.tasks)) {
        month.tasks = [];
    }

    return month.tasks;
}

function escapeTaskHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* --- field readers (safe defaults keep legacy tasks valid) --- */

function taskStatusValue(task) {
    if (task && TASK_STATUSES[task.status]) {
        return task.status;
    }

    return task && task.done ? "completed" : "new";
}

function taskPriorityValue(task) {
    return task && TASK_PRIORITIES[task.priority]
        ? task.priority
        : "medium";
}

function taskCategoryValue(task) {
    return task && TASK_CATEGORIES[task.category]
        ? task.category
        : "other";
}

function taskTimeValue(task) {
    return task && task.time ? String(task.time) : "";
}

function isTaskCompleted(task) {
    return taskStatusValue(task) === "completed";
}

/* --- date helpers (local time, no UTC surprises) --- */

function taskDateOnly(task) {
    const raw = task && task.date ? String(task.date) : "";
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);

    return match ? match[0] : "";
}

function taskDateLocal(task) {
    const iso = taskDateOnly(task);

    if (!iso) {
        return null;
    }

    const parts = iso.split("-");

    return new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );
}

function todayLocal() {
    const d = new Date();

    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/*
    Whole-day difference between the task date and today:
        negative -> the task is in the past
        0        -> today
        positive -> days ahead
        null     -> no (valid) date
*/
function taskDayDiff(task) {
    const date = taskDateLocal(task);

    if (!date) {
        return null;
    }

    return Math.round(
        (date.getTime() - todayLocal().getTime()) / 86400000
    );
}

/*
    A task is overdue only when it is NOT completed and its due
    date is before today. Completed tasks are never overdue.
*/
function isTaskOverdue(task) {
    if (isTaskCompleted(task)) {
        return false;
    }

    const diff = taskDayDiff(task);

    return diff !== null && diff < 0;
}

function isTaskToday(task) {
    if (isTaskCompleted(task)) {
        return false;
    }

    return taskDayDiff(task) === 0;
}

function taskDateBadge(task) {
    const diff = taskDayDiff(task);

    if (diff === null) {
        return { text: "بدون تاريخ", tone: "none" };
    }

    const time = taskTimeValue(task);
    const completed = isTaskCompleted(task);

    let text;

    if (completed) {
        text = formatDate(taskDateLocal(task));
    } else if (diff === 0) {
        text = "اليوم";
    } else if (diff === 1) {
        text = "غدًا";
    } else if (diff < 0) {
        text = "متأخرة";
    } else {
        text = formatDate(taskDateLocal(task));
    }

    let tone = "upcoming";

    if (completed) {
        tone = "done";
    } else if (diff < 0) {
        tone = "overdue";
    } else if (diff === 0) {
        tone = "today";
    } else if (diff === 1) {
        tone = "tomorrow";
    }

    return {
        text: time ? `${text} · ${time}` : text,
        tone
    };
}

/* --- recurrence helpers --- */

function taskDateISO(date) {
    if (!date) {
        return "";
    }

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${date.getFullYear()}-${month}-${day}`;
}

/*
    Reads the optional recurrence settings. Returns null when the
    task is not recurring (which is every legacy task), so old data
    keeps working exactly as before.
*/
function taskRepeatValue(task) {
    const raw = task && task.repeat;

    if (!raw || typeof raw !== "object") {
        return null;
    }

    if (!TASK_REPEAT_MODES[raw.mode]) {
        return null;
    }

    if (raw.mode === "custom") {
        let interval = parseInt(raw.interval, 10);

        if (!Number.isFinite(interval) || interval < 1) {
            interval = 1;
        }

        return {
            mode: "custom",
            interval,
            unit: TASK_REPEAT_UNITS[raw.unit] ? raw.unit : "day",
            active: raw.active !== false
        };
    }

    const unit =
        raw.mode === "daily" ? "day"
            : raw.mode === "weekly" ? "week"
                : raw.mode === "monthly" ? "month"
                    : "year";

    return {
        mode: raw.mode,
        interval: 1,
        unit,
        active: raw.active !== false
    };
}

function isTaskRecurring(task) {
    return taskRepeatValue(task) !== null;
}

function isTaskRepeatActive(task) {
    const repeat = taskRepeatValue(task);

    return Boolean(repeat && repeat.active);
}

/* Arabic dual / plural forms used by the recurrence badge */

function taskRepeatUnitText(unit, count) {
    if (unit === "week") {
        if (count === 1) return "أسبوع";
        if (count === 2) return "أسبوعين";
        if (count >= 3 && count <= 10) return `${count} أسابيع`;
        return `${count} أسبوعًا`;
    }

    if (unit === "month") {
        if (count === 1) return "شهر";
        if (count === 2) return "شهرين";
        if (count >= 3 && count <= 10) return `${count} أشهر`;
        return `${count} شهرًا`;
    }

    if (unit === "year") {
        if (count === 1) return "سنة";
        if (count === 2) return "سنتين";
        if (count >= 3 && count <= 10) return `${count} سنوات`;
        return `${count} سنة`;
    }

    if (count === 1) return "يوم";
    if (count === 2) return "يومين";
    if (count >= 3 && count <= 10) return `${count} أيام`;

    return `${count} يومًا`;
}

function taskRepeatLabel(task) {
    const repeat = taskRepeatValue(task);

    if (!repeat) {
        return "";
    }

    if (repeat.mode === "custom") {
        return `كل ${taskRepeatUnitText(repeat.unit, repeat.interval)}`;
    }

    return TASK_REPEAT_MODES[repeat.mode].label;
}

/*
    Adds months while clamping the day to the last valid day of the
    target month: 31 Jan -> 28/29 Feb instead of spilling into March.
*/
function addMonthsTaskDate(date, months) {
    const year = date.getFullYear();
    const month = date.getMonth() + months;
    const day = date.getDate();

    const lastDay = new Date(year, month + 1, 0).getDate();

    return new Date(year, month, Math.min(day, lastDay));
}

/* One single step inside the chosen pattern */

function advanceTaskDate(date, repeat) {
    if (!date || !repeat) {
        return null;
    }

    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    if (repeat.mode === "daily") {
        return new Date(year, month, day + 1);
    }

    if (repeat.mode === "weekly") {
        return new Date(year, month, day + 7);
    }

    if (repeat.mode === "monthly") {
        return addMonthsTaskDate(date, 1);
    }

    if (repeat.mode === "yearly") {
        return addMonthsTaskDate(date, 12);
    }

    if (repeat.unit === "month") {
        return addMonthsTaskDate(date, repeat.interval);
    }

    const step = repeat.unit === "week"
        ? repeat.interval * 7
        : repeat.interval;

    return new Date(year, month, day + step);
}

/*
    Next due date of a recurring task.

    It always moves forward and catches up to today, so completing a
    long overdue recurring task does not spawn a backlog of overdue
    copies.
*/
function nextTaskDate(task) {
    const repeat = taskRepeatValue(task);

    if (!repeat || !repeat.active) {
        return null;
    }

    const base = taskDateLocal(task);

    if (!base) {
        return null;
    }

    let next = advanceTaskDate(base, repeat);

    if (!next) {
        return null;
    }

    const today = todayLocal();

    let guard = 0;

    while (next.getTime() < today.getTime() && guard < 10000) {
        next = advanceTaskDate(next, repeat);

        if (!next) {
            return null;
        }

        guard += 1;
    }

    return next;
}

/* Stable id shared by every occurrence of one series */

function taskSeriesId(task) {
    return task && task.repeatId ? task.repeatId : task.id;
}

/*
    Called when a recurring task is completed. The completed task is
    kept as history and the next occurrence is scheduled.
*/
function spawnNextRecurringTask(task) {
    const repeat = taskRepeatValue(task);

    if (!repeat || !repeat.active) {
        return false;
    }

    const next = nextTaskDate(task);

    if (!next) {
        return false;
    }

    const nextIso = taskDateISO(next);
    const month = currentMonthData();
    const tasks = ensureTasks(month);
    const seriesId = taskSeriesId(task);

    // Never stack two open occurrences of the same series.

    const alreadyScheduled = tasks.some((item) =>
        item !== task &&
        taskSeriesId(item) === seriesId &&
        !isTaskCompleted(item) &&
        taskDateOnly(item) >= nextIso
    );

    if (alreadyScheduled) {
        return false;
    }

    tasks.push({
        id: Date.now(),
        listKey: task.listKey,
        repeatId: seriesId,
        title: task.title,
        note: task.note || "",
        time: task.time || "",
        priority: task.priority,
        category: task.category,
        status: "new",
        done: false,
        date: nextIso,
        repeat: {
            mode: repeat.mode,
            interval: repeat.interval,
            unit: repeat.unit,
            active: repeat.active
        }
    });

    return true;
}

/* --- statistics --- */

function taskStats(tasks) {
    const stats = {
        all: tasks.length,
        today: 0,
        overdue: 0,
        inProgress: 0,
        completed: 0
    };

    tasks.forEach((task) => {

        if (isTaskToday(task)) {
            stats.today += 1;
        }

        if (isTaskOverdue(task)) {
            stats.overdue += 1;
        }

        const status = taskStatusValue(task);

        if (status === "inProgress") {
            stats.inProgress += 1;
        }

        if (status === "completed") {
            stats.completed += 1;
        }

    });

    return stats;
}

/* --- summary-card quick filter (kept from the current design) --- */

function taskMatchesQuick(task, quick) {
    switch (quick) {
        case "today":
            return isTaskToday(task);

        case "overdue":
            return isTaskOverdue(task);

        case "inProgress":
            return taskStatusValue(task) === "inProgress";

        case "completed":
            return isTaskCompleted(task);

        default:
            return true;
    }
}

function applyQuickFilter(tasks, quick) {
    if (!quick || quick === "all") {
        return tasks;
    }

    return tasks.filter((task) => taskMatchesQuick(task, quick));
}

/* --- display ordering (view only, never changes saved data) ---
   1) overdue
   2) high / urgent priority
   3) today
   4) upcoming, by date
   5) no date
   6) completed (always last)
------------------------------------------------------------- */

function taskSortRank(task) {
    if (isTaskCompleted(task)) {
        return 5;
    }

    if (isTaskOverdue(task)) {
        return 0;
    }

    const priority = taskPriorityValue(task);

    if (priority === "urgent" || priority === "high") {
        return 1;
    }

    const diff = taskDayDiff(task);

    if (diff === 0) {
        return 2;
    }

    if (diff !== null) {
        return 3;
    }

    return 4;
}

function sortTasksForDisplay(tasks) {
    return tasks.slice().sort((a, b) => {

        const rankA = taskSortRank(a);
        const rankB = taskSortRank(b);

        if (rankA !== rankB) {
            return rankA - rankB;
        }

        const diffA = taskDayDiff(a);
        const diffB = taskDayDiff(b);

        const hasA = diffA !== null;
        const hasB = diffB !== null;

        if (hasA !== hasB) {
            return hasA ? -1 : 1;
        }

        if (hasA && diffA !== diffB) {
            // completed tasks: newest first, others: nearest first
            return rankA === 5 ? diffB - diffA : diffA - diffB;
        }

        const prioA = TASK_PRIORITIES[taskPriorityValue(a)].order;
        const prioB = TASK_PRIORITIES[taskPriorityValue(b)].order;

        if (prioA !== prioB) {
            return prioB - prioA;
        }

        const timeA = taskTimeValue(a);
        const timeB = taskTimeValue(b);

        if (timeA !== timeB) {
            return timeA < timeB ? -1 : 1;
        }

        return String(a.title || "").localeCompare(
            String(b.title || ""),
            "ar"
        );

    });
}

/* --- add / edit form --- */

function taskOptionHtml(value, label, selected) {
    return `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`;
}

function taskFormHtml({ title, task, listKey }) {
    const meta = TASK_LISTS[listKey] || TASK_LISTS.personalTasks;

    const repeat = taskRepeatValue(task);
    const custom = repeat && repeat.mode === "custom";

    const values = {
        title: task ? String(task.title || "") : "",
        note: task ? String(task.note || "") : "",
        date: task ? taskDateOnly(task) : todayDateInputValue(),
        time: task ? taskTimeValue(task) : "",
        priority: task ? taskPriorityValue(task) : "medium",
        category: task ? taskCategoryValue(task) : meta.defaultCategory,
        status: task ? taskStatusValue(task) : "new",
        repeat: repeat ? repeat.mode : "none",
        repeatInterval: custom ? repeat.interval : 1,
        repeatUnit: custom ? repeat.unit : "day",
        repeatStopped: repeat ? !repeat.active : false
    };

    const priorityOptions = Object.keys(TASK_PRIORITIES)
        .map((key) => taskOptionHtml(
            key,
            TASK_PRIORITIES[key].label,
            values.priority
        ))
        .join("");

    const categoryOptions = Object.keys(TASK_CATEGORIES)
        .map((key) => taskOptionHtml(
            key,
            `${TASK_CATEGORIES[key].icon} ${TASK_CATEGORIES[key].label}`,
            values.category
        ))
        .join("");

    const statusOptions = Object.keys(TASK_STATUSES)
        .map((key) => taskOptionHtml(
            key,
            TASK_STATUSES[key].label,
            values.status
        ))
        .join("");

    const repeatOptions = ["none"]
        .concat(Object.keys(TASK_REPEAT_MODES))
        .map((key) => taskOptionHtml(
            key,
            key === "none" ? "بدون تكرار" : TASK_REPEAT_MODES[key].label,
            values.repeat
        ))
        .join("");

    const unitOptions = Object.keys(TASK_REPEAT_UNITS)
        .map((key) => taskOptionHtml(
            key,
            TASK_REPEAT_UNITS[key].label,
            values.repeatUnit
        ))
        .join("");

    return `
        <h2 class="modal-title">${title}</h2>

        <form id="taskForm" class="task-form" autocomplete="off">

            <div class="form-group">

                <label for="taskTitle">
                    اسم المهمة <span class="required-mark">*</span>
                </label>

                <input
                    type="text"
                    id="taskTitle"
                    placeholder="مثال: دفع فاتورة الكهرباء"
                    value="${escapeTaskHtml(values.title)}"
                    autocomplete="off"
                    required
                >

            </div>

            <div class="form-row">

                <div class="form-group">

                    <label for="taskCategory">
                        التصنيف
                    </label>

                    <select id="taskCategory">
                        ${categoryOptions}
                    </select>

                </div>

                <div class="form-group">

                    <label for="taskPriority">
                        الأولوية
                    </label>

                    <select id="taskPriority">
                        ${priorityOptions}
                    </select>

                </div>

            </div>

            <div class="form-row">

                <div class="form-group">

                    <label for="taskDate">
                        تاريخ الاستحقاق
                    </label>

                    <input
                        type="date"
                        id="taskDate"
                        value="${values.date}"
                    >

                </div>

                <div class="form-group">

                    <label for="taskTime">
                        الوقت (اختياري)
                    </label>

                    <input
                        type="time"
                        id="taskTime"
                        value="${values.time}"
                    >

                </div>

            </div>

            <div class="form-group">

                <label for="taskStatus">
                    الحالة
                </label>

                <select id="taskStatus">
                    ${statusOptions}
                </select>

            </div>

            <div class="form-group">

                <label for="taskRepeat">
                    تكرار المهمة
                </label>

                <select id="taskRepeat">
                    ${repeatOptions}
                </select>

                <span
                    class="task-repeat-hint"
                    id="taskRepeatStartHint"
                ></span>

            </div>

            <div
                class="form-row task-repeat-custom"
                id="taskRepeatCustom"
                style="display: none;"
            >

                <div class="form-group">

                    <label for="taskRepeatInterval">
                        تكرار كل (عدد)
                    </label>

                    <input
                        type="number"
                        id="taskRepeatInterval"
                        min="1"
                        step="1"
                        inputmode="numeric"
                        value="${values.repeatInterval}"
                    >

                </div>

                <div class="form-group">

                    <label for="taskRepeatUnit">
                        الوحدة
                    </label>

                    <select id="taskRepeatUnit">
                        ${unitOptions}
                    </select>

                </div>

            </div>

            <div
                class="form-row task-repeat-extra"
                id="taskRepeatExtra"
                style="display: none;"
            >

                <div class="form-group">

                    <label for="taskRepeatStop">
                        حالة التكرار
                    </label>

                    <select id="taskRepeatStop">
                        ${taskOptionHtml("no", "التكرار مفعل", values.repeatStopped ? "yes" : "no")}
                        ${taskOptionHtml("yes", "إيقاف التكرار", values.repeatStopped ? "yes" : "no")}
                    </select>

                </div>

                <div class="form-group">

                    <label for="taskEditScope">
                        نطاق التعديل
                    </label>

                    <select id="taskEditScope">
                        ${taskOptionHtml("one", "هذه المهمة فقط", "one")}
                        ${taskOptionHtml("series", "هذه والتكرارات القادمة", "one")}
                    </select>

                </div>

            </div>

            <div class="form-group">

                <label for="taskNote">
                    ملاحظات (اختياري)
                </label>

                <textarea
                    id="taskNote"
                    rows="3"
                    placeholder="تفاصيل إضافية..."
                >${escapeTaskHtml(values.note)}</textarea>

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
    `;
}

function openAddTaskModal(listKey, modalTitle) {
    openModal(
        taskFormHtml({
            title: modalTitle,
            task: null,
            listKey
        })
    );

    bindTaskForm({
        mode: "add",
        listKey
    });
}

function openEditTaskModal(taskId) {
    const month = currentMonthData();

    const task = ensureTasks(month).find(
        (item) => item.id === Number(taskId)
    );

    if (!task) {
        return;
    }

    openModal(
        taskFormHtml({
            title: "تعديل المهمة",
            task,
            listKey: task.listKey
        })
    );

    bindTaskForm({
        mode: "edit",
        listKey: task.listKey,
        taskId: task.id
    });
}

/*
    Reads the recurrence fields of the add/edit form.
    Returns a plain object, or null for "بدون تكرار".
*/
function readTaskRepeatForm() {
    const mode = $("taskRepeat")?.value;

    if (!mode || mode === "none") {
        return null;
    }

    const stopped = $("taskRepeatStop")?.value === "yes";

    if (mode === "custom") {
        let interval = parseInt($("taskRepeatInterval")?.value, 10);

        if (!Number.isFinite(interval) || interval < 1) {
            interval = 1;
        }

        const unit = $("taskRepeatUnit")?.value;

        return {
            mode: "custom",
            interval,
            unit: TASK_REPEAT_UNITS[unit] ? unit : "day",
            active: !stopped
        };
    }

    const unit =
        mode === "daily" ? "day"
            : mode === "weekly" ? "week"
                : mode === "monthly" ? "month"
                    : "year";

    return { mode, interval: 1, unit, active: !stopped };
}

function bindTaskForm({ mode, listKey, taskId }) {
    const form = $("taskForm");

    if (!form) {
        return;
    }

    /* Recurrence UI: custom fields, scope/stop row and start date. */

    const refreshRepeatUI = () => {
        const selected = $("taskRepeat")?.value || "none";

        const customGroup = $("taskRepeatCustom");

        if (customGroup) {
            customGroup.style.display =
                selected === "custom" ? "" : "none";
        }

        const extraGroup = $("taskRepeatExtra");

        if (extraGroup) {
            // Only an existing task can be stopped / edited in bulk.
            extraGroup.style.display =
                mode === "edit" && selected !== "none" ? "" : "none";
        }

        const hint = $("taskRepeatStartHint");

        if (hint) {
            const start = $("taskDate")?.value || "";

            hint.textContent = selected === "none"
                ? ""
                : `تاريخ بداية التكرار: ${start || "بدون تاريخ"}`;
        }
    };

    $("taskRepeat")?.addEventListener("change", refreshRepeatUI);
    $("taskDate")?.addEventListener("change", refreshRepeatUI);

    refreshRepeatUI();

    form.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const title = String($("taskTitle")?.value || "").trim();

            if (!title) {
                showToast("أدخل اسم المهمة");
                return;
            }

            const statusSelect = $("taskStatus")?.value;
            const prioritySelect = $("taskPriority")?.value;
            const categorySelect = $("taskCategory")?.value;

            const status = TASK_STATUSES[statusSelect]
                ? statusSelect
                : "new";

            const repeat = readTaskRepeatForm();

            const data = {
                title,
                note: String($("taskNote")?.value || "").trim(),
                date: taskDateOnly({
                    date: $("taskDate")?.value || ""
                }),
                time: String($("taskTime")?.value || ""),
                priority: TASK_PRIORITIES[prioritySelect]
                    ? prioritySelect
                    : "medium",
                category: TASK_CATEGORIES[categorySelect]
                    ? categorySelect
                    : "other",
                status,
                done: status === "completed",
                repeat
            };

            const month = currentMonthData();
            const tasks = ensureTasks(month);

            if (mode === "edit") {

                const task = tasks.find(
                    (item) => item.id === Number(taskId)
                );

                if (!task) {
                    return;
                }

                const previousRepeat = taskRepeatValue(task);
                const scope = $("taskEditScope")?.value;
                const stopping = !repeat || !repeat.active;

                Object.assign(task, data);

                if (repeat && !task.repeatId) {
                    task.repeatId = task.id;
                }

                if (previousRepeat) {

                    // Open occurrences of this series only - the ones
                    // already completed are history and stay untouched.

                    const members = tasks.filter((item) =>
                        item !== task &&
                        !isTaskCompleted(item) &&
                        taskSeriesId(item) === taskSeriesId(task)
                    );

                    const applyRepeat = () => {
                        members.forEach((item) => {
                            item.repeat = repeat
                                ? {
                                    mode: repeat.mode,
                                    interval: repeat.interval,
                                    unit: repeat.unit,
                                    active: repeat.active
                                }
                                : null;
                        });
                    };

                    if (scope === "series") {

                        members.forEach((item) => {
                            item.title = data.title;
                            item.note = data.note;
                            item.time = data.time;
                            item.priority = data.priority;
                            item.category = data.category;
                        });

                        applyRepeat();

                    } else if (stopping) {

                        // Stopping the pattern stops the whole series
                        // but keeps every record already completed.
                        applyRepeat();
                    }
                }

                commit();
                closeModal();
                showToast("تم تحديث المهمة");

                return;
            }

            const newTask = Object.assign(
                {
                    id: Date.now(),
                    listKey
                },
                data
            );

            if (repeat) {
                newTask.repeatId = newTask.id;
            }

            tasks.push(newTask);

            commit();
            closeModal();
            showToast("تمت إضافة المهمة");

        }
    );
}

/* Clicking a summary card filters the list; clicking it again
   (or any other card) switches / clears the quick filter. */

function toggleTaskStat(value) {
    const parts = String(value || "").split(":");
    const listKey = parts[0];

    if (!TASK_LISTS[listKey]) {
        return;
    }

    const quick = parts[1] || "all";
    const state = taskViewState(listKey);

    state.quick = state.quick === quick ? "all" : quick;

    renderTaskToolbar(listKey);
    renderTaskList(listKey);
}

/* Delete always goes through a confirmation step so a stray tap
   never removes a task. Closed months keep the old rule: a normal
   click is blocked, a long-press forces the delete. */

function requestDeleteTask(taskId, force = false) {
    const month = currentMonthData();
    const locked = isMonthClosed(month.year, month.month);

    if (locked && !force) {
        showToast("🔒 شهر مغلق — اضغط مطولاً لحذف المهمة");
        return;
    }

    const task = ensureTasks(month).find(
        (item) => item.id === Number(taskId)
    );

    if (!task) {
        return;
    }

    openModal(`
        <h2 class="modal-title">حذف المهمة</h2>

        <p class="modal-hint">
            ${escapeTaskHtml(task.title || "")}
        </p>

        ${isTaskRecurring(task) ? `
        <p class="modal-hint">
            🔄 ستُحذف هذه المهمة فقط — يبقى سجل المهام السابقة المكتملة.
        </p>
        ` : ""}

        ${locked ? `
        <p class="locked-hint">
            🔒 هذا الشهر مغلق. سيتم حذف المهمة نهائيًا.
        </p>
        ` : ""}

        <div class="form-row">

            <button
                type="button"
                class="form-submit danger"
                id="confirmDeleteTaskButton"
            >
                حذف
            </button>

            <button
                type="button"
                class="form-submit ghost"
                id="cancelDeleteTaskButton"
            >
                إلغاء
            </button>

        </div>
    `);

    $("confirmDeleteTaskButton")?.addEventListener(
        "click",
        () => {

            closeModal();

            deleteTask(taskId, locked);

        }
    );

    $("cancelDeleteTaskButton")?.addEventListener(
        "click",
        closeModal
    );
}

function toggleTask(taskId) {
    const month = currentMonthData();

    const tasks = ensureTasks(month);

    const task = tasks.find(
        (item) => item.id === Number(taskId)
    );

    if (!task) {
        return;
    }

    // Completing keeps the task (never deletes it) so it can be
    // reopened later; `done` is kept in sync with `status`.

    if (isTaskCompleted(task)) {
        task.status = "new";
        task.done = false;
    } else {
        task.status = "completed";
        task.done = true;

        // Recurring: keep this one as history and schedule the next
        // occurrence automatically (unless the pattern was stopped).

        spawnNextRecurringTask(task);
    }

    commit();
}

function deleteTask(taskId, force = false) {
    const month = currentMonthData();

    if (
        !force &&
        isMonthClosed(month.year, month.month)
    ) {
        showToast("🔒 شهر مغلق — استخدم الضغط المطول");
        return;
    }

    const tasks = ensureTasks(month);

    month.tasks = tasks.filter(
        (item) => item.id !== Number(taskId)
    );

    commit();
    showToast("تم حذف المهمة");
}

function taskRowHtml(task) {
    const status = taskStatusValue(task);
    const priority = taskPriorityValue(task);
    const category = taskCategoryValue(task);

    const priorityMeta = TASK_PRIORITIES[priority];
    const statusMeta = TASK_STATUSES[status];
    const categoryMeta = TASK_CATEGORIES[category];

    const dateBadge = taskDateBadge(task);
    const note = String(task.note || "").trim();

    const repeatLabel = taskRepeatLabel(task);
    const repeatActive = isTaskRepeatActive(task);

    return `
        <div
            class="record-row task-row task-status-${status} task-priority-${priority}"
            data-task-row="${task.id}"
        >

            <button
                type="button"
                class="task-check"
                data-task-toggle="${task.id}"
                aria-label="${status === "completed" ? "إعادة فتح المهمة" : "إكمال المهمة"}"
            >
                ${status === "completed" ? "✓" : ""}
            </button>

            <div class="record-info task-info">

                <strong class="task-title">
                    ${escapeTaskHtml(task.title || "")}
                </strong>

                <div class="task-meta">

                    <span class="task-badge task-cat">
                        ${categoryMeta.icon} ${categoryMeta.label}
                    </span>

                    <span class="task-badge task-pri task-pri-${priority}">
                        ${priorityMeta.label}
                    </span>

                    <span class="task-badge task-date task-date-${dateBadge.tone}">
                        ${dateBadge.text}
                    </span>

                    <span class="task-badge task-state task-state-${status}">
                        ${statusMeta.label}
                    </span>

                    ${repeatLabel ? `
                    <span class="task-badge task-repeat ${repeatActive ? "" : "task-repeat-off"}">
                        ${repeatActive ? "🔄" : "⏸️"} ${repeatLabel}
                    </span>
                    ` : ""}

                </div>

                ${note ? `
                <p class="task-note">
                    ${escapeTaskHtml(note)}
                </p>
                ` : ""}

            </div>

            <div class="task-actions">

                <button
                    type="button"
                    class="task-action"
                    data-task-edit="${task.id}"
                    aria-label="تعديل المهمة"
                    title="تعديل"
                >
                    ✎
                </button>

                <button
                    type="button"
                    class="delete-record"
                    data-task-delete="${task.id}"
                    aria-label="حذف المهمة"
                    title="حذف"
                >
                    ×
                </button>

            </div>

        </div>
    `;
}

function taskListTasks(listKey) {
    return ensureTasks(currentMonthData()).filter(
        (task) => task.listKey === listKey
    );
}

function taskStatCardsHtml(listKey, stats, quick) {
    const cards = [
        { key: "all", label: "كل المهام", value: stats.all, icon: "📋" },
        { key: "today", label: "مهام اليوم", value: stats.today, icon: "📅" },
        { key: "overdue", label: "المتأخرة", value: stats.overdue, icon: "⏰" },
        { key: "inProgress", label: "قيد التنفيذ", value: stats.inProgress, icon: "⏳" },
        { key: "completed", label: "المكتملة", value: stats.completed, icon: "✅" }
    ];

    return cards.map((card) => `
        <button
            type="button"
            class="task-stat ${quick === card.key ? "active" : ""}"
            data-task-stat="${listKey}:${card.key}"
            aria-pressed="${quick === card.key ? "true" : "false"}"
        >
            <span class="task-stat-value">
                ${card.value}
            </span>

            <span class="task-stat-label">
                ${card.icon} ${card.label}
            </span>
        </button>
    `).join("");
}

function renderTaskToolbar(listKey) {
    const meta = TASK_LISTS[listKey];
    const container = meta ? $(meta.toolbarId) : null;

    if (!container) {
        return;
    }

    const stats = taskStats(taskListTasks(listKey));
    const state = taskViewState(listKey);

    container.innerHTML = `
        <div class="task-stats">
            ${taskStatCardsHtml(listKey, stats, state.quick)}
        </div>
    `;
}

function renderTaskList(listKey) {
    const meta = TASK_LISTS[listKey];
    const list = meta ? $(meta.listId) : null;

    if (!list) {
        return;
    }

    const all = taskListTasks(listKey);

    if (!all.length) {
        list.innerHTML = emptyListHtml("لا توجد مهام بعد");
        return;
    }

    const state = taskViewState(listKey);
    const visible = sortTasksForDisplay(
        applyQuickFilter(all, state.quick)
    );

    if (!visible.length) {
        list.innerHTML = emptyListHtml("لا توجد مهام مطابقة");
        return;
    }

    list.innerHTML = visible.map(taskRowHtml).join("");

    // Closed month: rows are read-only except for a long-press delete.

    if (isMonthClosed()) {
        Array.from(list.children).forEach((row) => {

            const taskId =
                row.querySelector("[data-task-delete]")?.dataset.taskDelete;

            if (!taskId) {
                return;
            }

            attachRecordPress(
                row,
                () => requestDeleteTask(taskId, true)
            );

        });
    }
}

function renderTasks() {
    Object.keys(TASK_LISTS).forEach((listKey) => {
        renderTaskToolbar(listKey);
        renderTaskList(listKey);
    });
}

/* TASK RENDER APPEND */



function formatDate(iso) {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/* --- SAVINGS MODALS --- */

function savingsTransactionFormHtml({ title, submitLabel }) {
    return `
        <h2 class="modal-title">${title}</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericAmount">
                    المبلغ (د.ع)
                </label>

                <input
                    type="text"
                    id="genericAmount"

                    inputmode="numeric"
                    required

                    data-money
                >

            </div>

            <div class="form-group">

                <label for="genericDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="genericDate"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericNote">
                    ملاحظة (اختياري)
                </label>

                <input
                    type="text"
                    id="genericNote"
                    placeholder="ملاحظة..."
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                ${submitLabel}
            </button>

        </form>
    `;
}

function getFormDate() {
    const value = $("genericDate")?.value;

    if (!value) {
        return new Date().toISOString();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? new Date().toISOString()
        : date.toISOString();
}

function getFormNote() {
    return $("genericNote")?.value?.trim() || "";
}

function openDepositModal() {
    openModal(
        savingsTransactionFormHtml({
            title: "إيداع في الادخار",
            submitLabel: "إيداع"
        })
    );

    bindGenericForm(
        (amount) => {

            addSavingsTransaction({
                type: "deposit",
                amount,
                note: getFormNote(),
                date: getFormDate()
            });

            commit();
            closeModal();
            showToast("تم الإيداع");

        }
    );
}

function openWithdrawModal() {
    openModal(
        savingsTransactionFormHtml({
            title: "سحب من الادخار",
            submitLabel: "سحب"
        })
    );

    bindGenericForm(
        (amount) => {

            if (amount > getSavingsBalance()) {
                showToast("المبلغ أكبر من الرصيد الحالي");
                return;
            }

            addSavingsTransaction({
                type: "withdraw",
                amount,
                note: getFormNote(),
                date: getFormDate()
            });

            commit();
            closeModal();
            showToast("تم السحب");

        }
    );
}

/* --- DEBTORS --- */

function openAddDebtorModal() {
    openModal(
        `
        <h2 class="modal-title">إضافة مدين</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericTitle">
                    اسم الشخص
                </label>

                <input
                    type="text"
                    id="genericTitle"
                    placeholder="مثال: أحمد"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericRequired">
                    المبلغ المطلوب (د.ع)
                </label>

                <input
                    type="text"
                    id="genericRequired"

                    inputmode="numeric"
                    required

                    data-money
                >

            </div>

            <div class="form-group">

                <label for="genericPaid">
                    المدفوع فعلياً (د.ع)
                </label>

                <input
                    type="text"
                    id="genericPaid"

                    inputmode="numeric"
                    value="0"

                    data-money
                >

            </div>

            <div class="form-group">

                <label for="genericNote">
                    ملاحظة (اختياري)
                </label>

                <input
                    type="text"
                    id="genericNote"
                    placeholder="ملاحظة..."
                >

            </div>

            <div class="form-group">

                <label for="genericDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="genericDate"
                    required
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
        `
    );

    const form = $("genericForm");

    if (!form) {
        return;
    }

    form.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const name = $("genericTitle")?.value?.trim();

            const required = numberValue($("genericRequired")?.value);

            const paid = numberValue($("genericPaid")?.value);

            if (!name) {
                showToast("أدخل اسم المدين");
                return;
            }

            if (required <= 0) {
                showToast("أدخل مبلغاً صحيحاً");
                return;
            }

            const ledger = getSavingsLedger();

            ledger.debtors.push({
                id: Date.now(),
                name,
                required,
                paid,
                note: getFormNote(),
                date: getFormDate()
            });

            commit();
            closeModal();
            showToast("تمت إضافة المدين");

        }
    );
}

function openDebtorPaymentModal(debtorId) {
    const ledger = getSavingsLedger();

    const debtor = ledger.debtors.find(
        (item) => item.id === Number(debtorId)
    );

    if (!debtor) {
        return;
    }

    const remaining = Math.max(
        numberValue(debtor.required) - numberValue(debtor.paid),
        0
    );

    if (remaining <= 0) {
        showToast("تم تسديد كامل المبلغ");
        return;
    }

    openModal(
        amountFormHtml({
            title: `تسجيل دفعة - ${debtor.name}`,
            label: `المبلغ المتبقي: ${formatNumber(remaining)} د.ع`,
            submitLabel: "تسجيل الدفعة"
        })
    );

    bindGenericForm(
        (amount) => {

            if (amount > remaining) {
                showToast("المبلغ أكبر من المتبقي");
                return;
            }

            debtor.paid = numberValue(debtor.paid) + amount;

            addSavingsTransaction({
                type: "debtorPayment",
                amount,
                note: `دفعة من ${debtor.name}`
            });

            commit();
            closeModal();
            showToast("تم تسجيل الدفعة");

        }
    );
}

function deleteDebtor(debtorId) {
    const ledger = getSavingsLedger();

    ledger.debtors = ledger.debtors.filter(
        (item) => item.id !== Number(debtorId)
    );

    commit();
    showToast("تم حذف المدين");
}

function renderSavingsPage() {
    const stats = savingsStats();

    // Cumulative balance - never resets between months

    setText("savingsBalance", currency(stats.balance));
    setText("savingsDepositsTotal", currency(stats.deposits));
    setText("savingsWithdrawalsTotal", currency(stats.withdrawals));
    setText("savingsFromExpensesTotal", currency(stats.fromExpenses));
    setText("savingsDebtsTotal", currency(stats.debts));
    setText("savingsGrandTotal", currency(stats.grandTotal));

    // Monthly report for the currently viewed month

    const report = savingsMonthlyReport(currentYear, currentMonth);

    setText(
        "savingsMonthTitle",
        `${MONTH_NAMES[currentMonth]} ${currentYear}`
    );

    setText("savingsMonthDeposits", currency(report.deposits));
    setText("savingsMonthFromExpenses", currency(report.fromExpenses));
    setText("savingsMonthWithdrawals", currency(report.withdrawals));
    setText(
        "savingsMonthNet",
        `${report.net >= 0 ? "+" : "-"}${formatNumber(Math.abs(report.net))}`
    );

    renderDebtorsList();

    renderSavingsLog();
}

function renderDebtorsList() {
    const ledger = getSavingsLedger();

    const list = $("debtorsList");

    if (!list) {
        return;
    }

    if (!ledger.debtors.length) {
        list.innerHTML = emptyListHtml("لا يوجد مدينون بعد");
        return;
    }

    list.innerHTML = ledger.debtors
        .slice()
        .reverse()
        .map((debtor) => {

            const required = numberValue(debtor.required);

            const paid = numberValue(debtor.paid);

            const remaining = Math.max(required - paid, 0);

            const settled = remaining === 0;

            return `
                <div class="record-row debtor-row">

                    <div class="record-info">

                        <strong>
                            ${debtor.name}
                            ${settled
                                ? '<span class="settled-badge">تم التسديد</span>'
                                : ""}
                        </strong>

                        <span>
                            ${formatDate(debtor.date)}
                            ${debtor.note ? ` - ${debtor.note}` : ""}
                        </span>

                        <span class="debtor-amounts">
                            المطلوب ${formatNumber(required)}
                            - المدفوع ${formatNumber(paid)}
                            - المتبقي ${formatNumber(remaining)}
                        </span>

                    </div>

                    <div class="debtor-actions">

                        ${settled ? "" : `
                        <button
                            type="button"
                            class="small-action"
                            data-debtor-pay="${debtor.id}"
                        >
                            تسجيل دفعة
                        </button>
                        `}

                        <button
                            type="button"
                            class="delete-record"
                            data-debtor-delete="${debtor.id}"
                            aria-label="حذف"
                        >
                            ×
                        </button>

                    </div>

                </div>
            `;

        })
        .join("");
}

/* أنواع حركات الادخار: يشاركها السجل ورسالة التأكيد */
const SAVINGS_MOVEMENT_LABELS = {
    deposit: "إيداع ادخار",
    withdraw: "سحب من الادخار",
    fromExpenses: "تحويل من المصروفات",
    debtorPayment: "دفعة من مدين"
};

const SAVINGS_MOVEMENT_ICONS = {
    deposit: "＋",
    withdraw: "－",
    fromExpenses: "💰",
    debtorPayment: "👥"
};

/* الأحدث أولاً: بالتاريخ ثم وقت الإضافة */
function sortSavingsMovementsDesc(movements) {
    return movements.slice().sort((a, b) =>
        (new Date(b.date).getTime() || 0) -
        (new Date(a.date).getTime() || 0) ||
        (Number(b.id) || 0) - (Number(a.id) || 0)
    );
}

function renderSavingsLog() {
    const ledger = getSavingsLedger();

    const list = $("savingsLogList");

    if (!list) {
        return;
    }

    if (!ledger.transactions.length) {
        list.innerHTML = emptyListHtml("لا توجد حركات بعد");
        return;
    }

    list.innerHTML = sortSavingsMovementsDesc(ledger.transactions)
        .map((transaction) => {

            const negative = transaction.type === "withdraw";

            const label =
                SAVINGS_MOVEMENT_LABELS[transaction.type] || "حركة";

            const icon =
                SAVINGS_MOVEMENT_ICONS[transaction.type] || "•";

            const note = String(transaction.note || "").trim();

            return `
                <div class="record-row savings-movement-row">

                    <span class="record-icon">
                        ${icon}
                    </span>

                    <div class="record-info">

                        <strong>
                            ${label}
                        </strong>

                        <span>
                            ${formatDateTime(transaction.date)}
                            ${note ? ` • ${escapeTaskHtml(note)}` : ""}
                        </span>

                    </div>

                    <strong class="record-amount ${negative ? "negative" : ""}">
                        ${negative ? "-" : "+"}${formatNumber(transaction.amount)}
                    </strong>

                    <button
                        type="button"
                        class="delete-record"
                        data-savings-delete="${transaction.id}"
                        aria-label="حذف الحركة"
                    >
                        🗑️
                    </button>

                </div>
            `;

        })
        .join("");
}

/*
    تأكيد ثم حذف حركة ادخار.

    يُحذف السجل من ledger.transactions فقط. ارتباط الحركة بالمتبقي
    يُعاد حسابه تلقائياً لأن savingsReserved() يقرأ نفس السجل،
    و commit() يعيد الحفظ والرسم والمزامنة بلا إعادة تحميل.
*/
function deleteSavingsMovement(movementId) {
    const ledger = getSavingsLedger();

    const movement = ledger.transactions.find(
        (item) => item.id === Number(movementId)
    );

    if (!movement) {
        return;
    }

    openConfirmDialog({
        title: "حذف حركة الادخار؟",
        message:
            `${SAVINGS_MOVEMENT_LABELS[movement.type] || "حركة"}` +
            ` بمبلغ ${currency(movement.amount)}`,
        confirmLabel: "حذف",
        onConfirm: () => {

            ledger.transactions = ledger.transactions.filter(
                (item) => item.id !== Number(movementId)
            );

            commit();

            showToast("تم حذف حركة الادخار");

        }
    });
}

/* __APPEND__ */






function recordRowHtml({ listName, record, icon, note }) {
    return `
        <div class="record-row">

            <span class="record-icon">
                ${icon}
            </span>

            <div class="record-info">

                <strong>
                    ${record.title}
                </strong>

                <span>
                    ${note}
                </span>

            </div>

            <strong class="record-amount">
                ${formatNumber(record.amount)}
            </strong>

            <button
                type="button"
                class="delete-record"
                data-delete="${listName}"
                data-delete-id="${record.id}"
                aria-label="حذف"
            >
                ×
            </button>

        </div>
    `;
}

function emptyListHtml(message) {
    return `
        <div class="record-empty">
            ${message}
        </div>
    `;
}

function sumOf(records) {
    return records.reduce(
        (total, record) => total + numberValue(record.amount),
        0
    );
}

function renderExpensesPage() {
    const month = currentMonthData();
    const settings = month.settings;

    setText("loanValue", formatNumber(settings.loan));
    setText("fuelBudgetValue", formatNumber(settings.fuelBudget));
    setText("mobileInternetValue", formatNumber(settings.mobileInternet));
    setText("homeContributionValue", formatNumber(settings.homeContribution));

    const fixedTotal =
        numberValue(settings.loan) +
        numberValue(settings.fuelBudget) +
        numberValue(settings.mobileInternet) +
        numberValue(settings.homeContribution);

    setText("fixedExpenseTotal", currency(fixedTotal));

    const finance = monthFinance(month, fixedTotal);

    /* نفس الرقم الذي يُخصم من المتبقي */
    setText(
        "savingValue",
        finance.savings > 0 ? formatNumber(finance.savings) : "غير محدد"
    );

    setText("salaryValue", formatNumber(finance.salary));
    setText("monthSpentTotal", currency(finance.spent));
    setText("monthWalletNet", signedCurrency(finance.walletNet));
    setText("monthRemaining", currency(finance.remaining));
    $("monthRemaining")?.classList.toggle("is-negative", finance.remaining < 0);
    setText("walletCardBalance", formatNumber(walletBalance()));

    const list = $("customExpenseList");

    if (list) {
        list.innerHTML = month.expenses.length
            ? month.expenses
                .slice()
                .reverse()
                .map((record) => recordRowHtml({
                    listName: "expenses",
                    record,
                    icon: record.walletTransactionId
                        ? "💳"
                        : (record.isSavings ? "💰" : "د.ع"),
                    note: record.walletTransactionId
                        ? "مصروف من صرف محفظتي"
                        : (record.isSavings
                            ? "ادخار من المصروفات الشخصية"
                            : "مصروف شخصي")
                }))
                .join("")
            : emptyListHtml("لا توجد مصاريف إضافية بعد");

        wireRecordRows(list, "expenses");
    }

    renderWalletPage();
}

function renderCarPage() {
    const month = currentMonthData();
    const settings = month.settings;

    const budget = numberValue(settings.fuelBudget);

    const fuelSpent = sumOf(
        month.carExpenses.filter((item) => item.kind === "fuel")
    );

    const total = sumOf(month.carExpenses);

    setText("carBudgetDisplay", currency(budget));
    setText("carSpentDisplay", currency(fuelSpent));
    setText("carRemainingDisplay", currency(Math.max(budget - fuelSpent, 0)));
    setText("carTotal", currency(total));

    /* ---- الزيوت والفلاتر والبطارية ---- */

    const partsTotal =
        sumOf(getCarPartRecords("oil")) +
        sumOf(getCarPartRecords("filter")) +
        sumOf(getCarPartRecords("battery"));

    setText("carPartsTotal", currency(partsTotal));

    setText("oilTotalAmount", currency(sumOf(getCarPartRecords("oil"))));
    setText("filterTotalAmount", currency(sumOf(getCarPartRecords("filter"))));
    setText("batteryTotalAmount", currency(sumOf(getCarPartRecords("battery"))));

    setText("oilLastChange", carPartLastChangeText("oil"));
    setText("filterLastChange", carPartLastChangeText("filter"));
    setText("batteryLastChange", carPartLastChangeText("battery"));

    const icons = {
        maintenance: "🔧",
        oil: CAR_PART_TYPES.oil.icon,
        filter: CAR_PART_TYPES.filter.icon,
        battery: CAR_PART_TYPES.battery.icon
    };

    const notes = {
        maintenance: "صيانة",
        oil: CAR_PART_TYPES.oil.label,
        filter: CAR_PART_TYPES.filter.label,
        battery: CAR_PART_TYPES.battery.label
    };

    const fuelRecords = getFuelRecords();

    const fuelLiters = fuelRecords.reduce(
        (total, record) => {
            return total + parseDecimal(record.liters);
        },
        0
    );

    setText("fuelTotalLiters", `${formatDecimals(fuelLiters, 2)} لتر`);
    setText("fuelTotalAmount", currency(sumOf(fuelRecords)));

    /* ---- سجل البنزين (داخل قسم البنزين) ---- */

    const fuelList = $("fuelRecordsList");

    if (fuelList) {
        fuelList.innerHTML = fuelRecords.length
            ? sortCarRecordsDesc(fuelRecords)
                .map((record) => fuelRecordRowHtml({
                    listName: "carExpenses",
                    record
                }))
                .join("")
            : emptyListHtml("لا توجد تعبئات بنزين بعد");

        wireRecordRows(fuelList, "carExpenses");
    }

    setText("fuelLogTotal", currency(sumOf(fuelRecords)));

    /* ---- سجل الصيانة (باقي مصاريف السيارة) ---- */

    const otherCarRecords = month.carExpenses.filter(
        (record) => record.kind !== "fuel"
    );

    setText("carMaintenanceLogTotal", currency(sumOf(otherCarRecords)));

    const list = $("carExpensesList");

    if (list) {
        list.innerHTML = otherCarRecords.length
            ? sortCarRecordsDesc(otherCarRecords)
                .map((record) => {

                    if (carPartMeta(record.kind)) {
                        return carPartRecordRowHtml({
                            listName: "carExpenses",
                            record,
                            kind: record.kind
                        });
                    }

                    return recordRowHtml({
                        listName: "carExpenses",
                        record,
                        icon: icons[record.kind] || "🚗",
                        note: notes[record.kind] || "مصروف سيارة"
                    });
                })
                .join("")
            : emptyListHtml("لا توجد سجلات صيانة بعد");

        wireRecordRows(list, "carExpenses");
    }
}

function renderHomeExpensesPage() {
    const month = currentMonthData();
    const settings = month.settings;

    const budget =
        numberValue(settings.homeContribution) +
        numberValue(settings.norhanContribution);

    const basic =
        numberValue(settings.generator) +
        numberValue(settings.homeInternet) +
        numberValue(settings.rent);

    const other = sumOf(month.homeExpenses);

    setText("homeBudgetValue", currency(budget));
    setText("homeContributionSummary", currency(settings.homeContribution));
    setText("norhanContributionSummary", currency(settings.norhanContribution));
    setText("homeBasicTotal", currency(basic));
    setText("homeRemaining", currency(Math.max(budget - basic - other, 0)));

    setText(
        "homeGroceriesTotal",
        currency(sumOf(month.homeExpenses.filter(isGroceryRecord)))
    );

    setText("generatorValue", formatNumber(settings.generator));
    setText("homeInternetValue", formatNumber(settings.homeInternet));
    setText("rentValue", formatNumber(settings.rent));

    const list = $("homeExpensesList");

    if (list) {
        const plainHomeExpenses = month.homeExpenses.filter(
            (record) => !isGroceryRecord(record)
        );

        list.innerHTML = plainHomeExpenses.length
            ? plainHomeExpenses
                .slice()
                .reverse()
                .map((record) => recordRowHtml({
                    listName: "homeExpenses",
                    record,
                    icon: "⌂",
                    note: "مصروف بيت"
                }))
                .join("")
            : emptyListHtml("لا توجد مصاريف بيت إضافية بعد");

        wireRecordRows(list, "homeExpenses");
    }
}

function renderHomePage() {
    const month = currentMonthData();

    const total =
        sumOf(month.expenses) +
        sumOf(month.carExpenses) +
        sumOf(month.homeExpenses);

    setText("homeTotalExpenses", currency(total));

    /* نفس رقم الادخار الذي يُخصم من المتبقي */
    const savings = savingsReserved(month.year, month.month);

    setText(
        "homeSavings",
        savings > 0 ? currency(savings) : "غير محدد"
    );
}

function renderAll() {
    ensureCurrentMonth();

    renderHomePage();

    renderExpensesPage();

    renderCarPage();

    renderHomeExpensesPage();

    renderWalletPage();

    renderGroceriesPage();

    renderGroceryCategoryPage();

    renderTasks();

    renderSavingsPage();
}

/* =========================================================
   CLOUD SYNC (Firebase Auth + Firestore)

    All app data (expenses, car, home, tasks, savings,
    settings) is stored under the signed-in account. localStorage stays
    as an offline cache - nothing is deleted on logout.
========================================================= */

function syncStatusView(status) {
    const phase = status && status.phase;

    if (phase === "syncing") {
        return { text: "⏳ جارٍ المزامنة...", tone: "busy" };
    }

    if (phase === "synced") {
        return { text: "✅ مزامن مع الحساب", tone: "ok" };
    }

    if (phase === "error") {
        return {
            text: `⚠️ ${status.message || "تعذّر المزامنة"}`,
            tone: "warn"
        };
    }

    if (phase === "unconfigured") {
        return { text: "⚙️ وضع محلي — بلا Firebase", tone: "off" };
    }

    return { text: "💾 محفوظ على هذا الجهاز", tone: "off" };
}

function renderSyncStatus(status) {
    const view = syncStatusView(status);

    const element = $("syncStatus");

    if (element) {
        element.textContent = view.text;
        element.dataset.tone = view.tone;
    }

    const button = $("accountButton");

    if (button) {
        const signedIn = Boolean(status && status.signedIn);

        button.classList.toggle("signed-in", signedIn);
        button.setAttribute(
            "aria-label",
            signedIn ? "حسابي" : "تسجيل الدخول"
        );
    }

    const modalStatus = $("authStatus");

    if (modalStatus) {
        modalStatus.textContent = view.text;
        modalStatus.dataset.tone = view.tone;
    }

    const emailLabel = $("authAccountEmail");

    if (emailLabel && status && status.email) {
        emailLabel.textContent = status.email;
    }
}

function syncExplainHtml() {
    return `
        <p class="modal-hint">
            كل بياناتك (المصاريف، السيارة، البيت، المهام، الادخار
            والإعدادات) تُحفظ باسم حسابك في Firestore، فتُسترجع تلقائياً
            عند الدخول من أي جهاز أو بعد إعادة إضافة الموقع إلى الشاشة.
        </p>
    `;
}

function signedOutAccountHtml() {
    return `
        <h2 class="modal-title" id="authFormTitle">
            الحساب والمزامنة
        </h2>

        ${syncExplainHtml()}

        <div class="account-status" id="authStatus"></div>

        <form id="authForm" class="auth-form" autocomplete="off">

            <div class="form-group">

                <label for="authEmail">
                    البريد الإلكتروني
                </label>

                <input
                    type="email"
                    id="authEmail"
                    placeholder="name@example.com"
                    required
                    autocomplete="email"
                >

            </div>

            <div class="form-group">

                <label for="authPassword">
                    كلمة المرور
                </label>

                <input
                    type="password"
                    id="authPassword"
                    minlength="6"
                    required
                    autocomplete="current-password"
                >

            </div>

            <p class="form-error hidden" id="authError"></p>

            <button
                type="submit"
                class="form-submit"
                id="authSubmit"
            >
                تسجيل الدخول
            </button>

            <button
                type="button"
                class="form-link"
                id="authToggle"
            >
                إنشاء حساب جديد
            </button>

        </form>
    `;
}

function signedInAccountHtml(user) {
    return `
        <h2 class="modal-title">حسابي</h2>

        ${syncExplainHtml()}

        <div class="account-card">

            <strong id="authAccountEmail">
                ${user.email || ""}
            </strong>

            <div class="account-status" id="authStatus"></div>

            <button
                type="button"
                class="form-submit"
                id="authSyncNow"
            >
                مزامنة الآن
            </button>

            <button
                type="button"
                class="form-submit danger"
                id="authSignOut"
            >
                تسجيل الخروج
            </button>

            <p class="modal-hint">
                عند تسجيل الخروج تبقى البيانات محفوظة على هذا الجهاز.
            </p>

        </div>
    `;
}

function unconfiguredAccountHtml() {
    return `
        <h2 class="modal-title">الحساب والمزامنة</h2>

        <div class="account-status" id="authStatus"></div>

        <p class="modal-hint">
            المزامنة مع Firebase غير مفعّلة بعد. أضف إعدادات مشروعك في
            الملف <code>firebase-config.js</code> ثم فعّل
            Email/Password في Authentication واضبط قواعد Firestore
            (التعليمات موجودة داخل الملف نفسه).
        </p>

        <p class="modal-hint">
            حتى ذلك الحين تبقى جميع البيانات محفوظة محلياً على هذا
            الجهاز ولن تُحذف.
        </p>
    `;
}

function wireAuthForm() {
    let mode = "signin";

    const form = $("authForm");
    const toggle = $("authToggle");
    const submit = $("authSubmit");
    const title = $("authFormTitle");
    const errorBox = $("authError");

    const label = () => (mode === "signin" ? "تسجيل الدخول" : "إنشاء الحساب");

    toggle?.addEventListener(
        "click",
        () => {
            mode = mode === "signin" ? "signup" : "signin";

            if (title) {
                title.textContent = mode === "signin"
                    ? "تسجيل الدخول"
                    : "إنشاء حساب جديد";
            }

            if (toggle) {
                toggle.textContent = mode === "signin"
                    ? "إنشاء حساب جديد"
                    : "لدي حساب — تسجيل الدخول";
            }

            if (submit) {
                submit.textContent = label();
            }

            errorBox?.classList.add("hidden");
        }
    );

    form?.addEventListener(
        "submit",
        (event) => {
            event.preventDefault();

            const email = $("authEmail")?.value.trim() || "";
            const password = $("authPassword")?.value || "";

            if (submit) {
                submit.disabled = true;
                submit.textContent = "جارٍ التنفيذ...";
            }

            errorBox?.classList.add("hidden");

            const action = mode === "signin"
                ? DaftariSync.signIn(email, password)
                : DaftariSync.signUp(email, password);

            action
                .then(
                    () => {
                        closeModal();
                        showToast("تم تسجيل الدخول — جارٍ استرجاع بياناتك");
                    }
                )
                .catch(
                    (error) => {
                        if (errorBox) {
                            errorBox.textContent =
                                error && error.message
                                    ? error.message
                                    : "تعذّرت العملية";
                            errorBox.classList.remove("hidden");
                        }
                    }
                )
                .then(
                    () => {
                        if (submit) {
                            submit.disabled = false;
                            submit.textContent = label();
                        }
                    }
                );
        }
    );
}

function wireSignedInAccount() {
    $("authSyncNow")?.addEventListener(
        "click",
        () => {
            const button = $("authSyncNow");

            if (button) {
                button.disabled = true;
                button.textContent = "جارٍ المزامنة...";
            }

            DaftariSync.pullNow()
                .then(() => DaftariSync.flushPending())
                .then(() => showToast("تمت مزامنة بياناتك"))
                .catch((error) => {
                    showToast(
                        error && error.message
                            ? error.message
                            : "تعذّرت المزامنة"
                    );
                })
                .then(
                    () => {
                        if (button) {
                            button.disabled = false;
                            button.textContent = "مزامنة الآن";
                        }
                    }
                );
        }
    );

    $("authSignOut")?.addEventListener(
        "click",
        () => {
            DaftariSync.signOut()
                .then(() => {
                    closeModal();
                    showToast("تم تسجيل الخروج — البيانات بقيت على هذا الجهاز");
                })
                .catch((error) => {
                    showToast(
                        error && error.message
                            ? error.message
                            : "تعذّر تسجيل الخروج"
                    );
                });
        }
    );
}
function openAccountModal() {
    if (typeof DaftariSync === "undefined") {
        openModal(`
            <h2 class="modal-title">الحساب والمزامنة</h2>
            <p class="modal-hint">وحدة المزامنة غير مثبتة.</p>
        `);

        return;
    }

    if (!DaftariSync.isConfigured()) {
        openModal(unconfiguredAccountHtml());
        renderSyncStatus(DaftariSync.getStatus());

        return;
    }

    const user = DaftariSync.getUser();

    if (user) {
        openModal(signedInAccountHtml(user));
        wireSignedInAccount();

    } else {
        openModal(signedOutAccountHtml());
        wireAuthForm();
    }

    renderSyncStatus(DaftariSync.getStatus());
}

function setupCloudSync() {
    if (typeof DaftariSync === "undefined") {
        renderSyncStatus({ phase: "local" });

        return;
    }

    DaftariSync
        .init({
            getDatabase: () => database,

            createMonth,

            defaultSettings: DEFAULT_MONTH_SETTINGS,

            persistLocal: () => {
                try {
                    localStorage.setItem(
                        STORAGE_KEY,
                        JSON.stringify(database)
                    );

                } catch (error) {
                    console.error("Daftari persist error:", error);
                }
            },

            onStatus: renderSyncStatus,

            onAuthChange: (user) => {
                renderSyncStatus(DaftariSync.getStatus());

                if (user) {
                    showToast("جارٍ استرجاع بياناتك من حسابك...");
                }

                renderAll();
            },

            onRemoteChange: () => {
                renderAll();
            }
        })
        .then(
            (user) => {
                if (user) {
                    renderAll();
                }
            }
        )
        .catch(
            (error) => {
                console.error("Daftari sync init error:", error);
            }
        );
}

/* =========================================================
   INIT
========================================================= */

/* =========================================================
   FINANCE SUMMARY (راتب / مصروف / محفظتي / متبقي)

   remaining = salary - spent - wallet net of THIS month
   where wallet net = deposits - withdrawals recorded in this month.
   A deposit takes money out of the available balance, a withdrawal
   gives it back - same single "remaining" figure the page already uses.
========================================================= */

function signedCurrency(value) {
    const number = Math.round(Number(value) || 0);

    if (number === 0) {
        return currency(0);
    }

    return `${number > 0 ? "+" : "-"}${formatNumber(Math.abs(number))} د.ع`;
}

/*
    المصروفات التي تُحتسب من الميزانية فعلاً.

    المصروف المحوَّل للادخار (isSavings) لا يُحسب هنا، لأن مبلغه
    يُخصم مرة واحدة عبر savingsReserved() (حركته في سجل الادخار).
    لو احتُسب هنا أيضاً لخصم نفس المبلغ مرتين.
*/
function spentExpensesTotal(month) {
    const expenses = Array.isArray(month.expenses) ? month.expenses : [];

    return expenses.reduce((total, record) => {

        if (!record || record.isSavings) {
            return total;
        }

        return total + numberValue(record.amount);

    }, 0);
}

function monthFinance(month, fixedTotal) {
    const salary = getSalary(month);

    const spent = fixedTotal + spentExpensesTotal(month);

    const key = monthKey(month.year, month.month);

    /* صافي ما مرّ بالمحفظة (للعرض فقط) */
    const walletNet = walletNetForMonth(key);

    /* ما دخل المحفظة فعلاً في هذا الشهر - يخفض المتبقي */
    const walletDeposits = walletDepositsForMonth(key);

    /* الادخار المخصوم من هذا الشهر فقط (محسوب مرة واحدة) */
    const savings = savingsReserved(month.year, month.month);

    /*
        المتبقي = الدخل - المصروفات - الإيداعات - الادخار

        الإيداع يخصم مباشرةً (مال انتقل من الميزانية إلى المحفظة)،
        والصرف ليس هنا لأنه مصروف حقيقي داخل المصروفات - لو خُصم
        مرتين لصار الخصم مزدوجاً.
    */
    return {
        salary,
        spent,
        walletNet,
        walletDeposits,
        savings,
        remaining: salary - spent - walletDeposits - savings
    };
}

function fixedExpensesTotal(month) {
    const settings = month.settings;

    return (
        numberValue(settings.loan) +
        numberValue(settings.fuelBudget) +
        numberValue(settings.mobileInternet) +
        numberValue(settings.homeContribution)
    );
}

function availableBalance(month = currentMonthData()) {
    return monthFinance(month, fixedExpensesTotal(month)).remaining;
}

/* =========================================================
   WALLET (محفظتي)

   Cumulative balance across ALL months, kept in the same cloud
   document as the savings ledger (database.savingsLedger.
   walletTransactions -> users/{uid}/meta/ledger). Each record:

     { id, type: "deposit" | "withdraw", amount, date, monthKey }

   `monthKey` is the month the operation was made in; it decides
   which month's available balance it affects. Changing the month
   never resets or edits the wallet balance itself.

   Accounting rules (never break them):

     deposit  -> money moves from the budget INTO the wallet:
                 wallet balance up, remaining down (walletDeposits),
                 NOT an expense.

     withdraw -> money leaves the wallet and becomes a real expense:
                 wallet balance down, an entry is added to
                 month.expenses sharing the same `id`, and the
                 remaining drops through the expenses total.
                 It is NOT subtracted again via the wallet.

   Both sides share one id (`walletTransactionId`), so deleting
   either one (the movement or the expense) removes both.
========================================================= */

function getWalletTransactions() {
    if (
        !database.savingsLedger ||
        typeof database.savingsLedger !== "object"
    ) {
        database.savingsLedger = {
            transactions: [],
            debtors: []
        };
    }

    if (!Array.isArray(database.savingsLedger.walletTransactions)) {
        database.savingsLedger.walletTransactions = [];
    }

    return database.savingsLedger.walletTransactions.filter(
        (transaction) => transaction && typeof transaction === "object"
    );
}

function walletBalance() {
    return getWalletTransactions().reduce((balance, transaction) => {

        const amount = numberValue(transaction.amount);

        if (transaction.type === "deposit") {
            return balance + amount;
        }

        if (transaction.type === "withdraw") {
            return balance - amount;
        }

        return balance;

    }, 0);
}

function walletNetForMonth(key) {
    return getWalletTransactions().reduce((net, transaction) => {

        if (transaction.monthKey !== key) {
            return net;
        }

        const amount = numberValue(transaction.amount);

        if (transaction.type === "deposit") {
            return net + amount;
        }

        if (transaction.type === "withdraw") {
            return net - amount;
        }

        return net;

    }, 0);
}

/*
    إجمالي ما دخل المحفظة في شهر معيّن (الإيداعات فقط).

    الإيداع ينقل المال من الميزانية إلى المحفظة، فهو يُخصم من
    المتبقي. أما الصرف فيُسجَّل مصروفاً حقيقياً داخل month.expenses
    ويظهر أثره عبر المصروفات - لو خُصم أيضاً من هنا لخصم المبلغ
    مرتين.
*/
function walletDepositsForMonth(key) {
    return getWalletTransactions().reduce((total, transaction) => {

        if (transaction.monthKey !== key) {
            return total;
        }

        if (transaction.type !== "deposit") {
            return total;
        }

        return total + numberValue(transaction.amount);

    }, 0);
}

/*
    معرّف حركة المحفظة: تصاعدي دائماً حتى لو حدثت حركتان
    في نفس المللي ثانية، فيبقى ترتيب السجل (الأحدث أولاً) ثابتاً.
*/
function nextWalletTransactionId() {
    const ledger = getSavingsLedger();

    const lastId = ledger.walletTransactions.reduce(
        (max, transaction) => Math.max(max, Number(transaction.id) || 0),
        0
    );

    return Math.max(Date.now(), lastId + 1);
}

/*
    الإيداع يخصم من المتبقي فقط. والصرف مصروف حقيقي يُضاف
    إلى month.expenses بنفس المعرّف، فلا يُخصم مرتين.
*/

/*
    Validates and records one wallet operation.
    Returns { ok: true, transaction } or { ok: false, message }.
*/
function addWalletTransaction(type, rawAmount) {
    if (type !== "deposit" && type !== "withdraw") {
        return { ok: false, message: "عملية غير معروفة" };
    }

    const amount = numberValue(rawAmount);

    if (amount <= 0) {
        return { ok: false, message: "أدخل مبلغاً صحيحاً" };
    }

    if (type === "withdraw" && amount > walletBalance()) {
        return { ok: false, message: "رصيد المحفظة غير كافٍ." };
    }

    getWalletTransactions();

    const transaction = {
        id: nextWalletTransactionId(),
        type,
        amount,
        date: new Date().toISOString(),
        monthKey: monthKey()
    };

    database.savingsLedger.walletTransactions.push(transaction);

    /*
        الصرف مصروف فعلي: يُضاف إلى month.expenses بنفس المعرّف
        ليربط السجلين. أما الإيداع فلا يُضاف هنا - هو فقط ما ينقل
        المال من الميزانية إلى المحفظة ويخفض المتبقي.
    */
    if (type === "withdraw") {
        const month = currentMonthData();

        month.expenses.push({
            id: transaction.id,
            title: "صرف من المحفظة",
            amount,
            walletTransactionId: transaction.id,
            date: transaction.date
        });
    }

    return { ok: true, transaction };
}

/*
    حذف حركة محفظة مع عكس أثرها بالكامل:

      حذف إيداع  -> يخرج المبلغ من المحفظة ويعود إلى المتبقي
      حذف صرف   -> يعود المبلغ إلى المحفظة ويُحذف مصروفه المرتبط
*/
function deleteWalletMovement(transactionId) {
    const ledger = getSavingsLedger();

    const id = Number(transactionId);

    const transaction = ledger.walletTransactions.find(
        (item) => item.id === id
    );

    if (!transaction) {
        return;
    }

    openConfirmDialog({
        title: "حذف حركة المحفظة؟",
        message:
            `${transaction.type === "deposit" ? "إيداع" : "صرف"}` +
            ` بمبلغ ${currency(transaction.amount)}`,
        confirmLabel: "حذف",
        onConfirm: () => {

            ledger.walletTransactions = ledger.walletTransactions.filter(
                (item) => item.id !== id
            );

            /* المصروف المرتبط بالصرف يذهب معه حتى لا يبقى يتيماً */
            const month = database.months[transaction.monthKey];

            if (month && Array.isArray(month.expenses)) {
                month.expenses = month.expenses.filter(
                    (record) => record.walletTransactionId !== id
                );
            }

            commit();

            showToast("تم حذف حركة المحفظة");

        }
    });
}

/*
    يفتح/يغلق بطاقة محفظتي (إظهار إيداع / صرف فقط).
*/
function toggleWalletCard() {
    const card = $("walletCard");

    if (!card) {
        return;
    }

    const open = card.classList.toggle("open");

    $("walletToggleButton")?.setAttribute(
        "aria-expanded",
        open ? "true" : "false"
    );
}

function openWalletModal(type) {
    if (isMonthClosed()) {
        showToast("🔒 شهر مغلق");
        return;
    }

    const isDeposit = type === "deposit";

    openModal(
        amountFormHtml({
            title: isDeposit ? "إيداع في محفظتي" : "صرف من محفظتي",
            label: "المبلغ (د.ع)",
            submitLabel: isDeposit ? "إيداع" : "صرف",
            hint: `الرصيد الحالي: ${currency(walletBalance())}`
        })
    );

    bindGenericForm(
        (amount) => {

            const result = addWalletTransaction(type, amount);

            if (!result.ok) {
                showToast(result.message);
                return;
            }

            commit();
            closeModal();
            showToast(isDeposit ? "تم الإيداع في المحفظة" : "تم الصرف من المحفظة");

        }
    );
}

function formatDateTime(iso) {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const pad = (value) => String(value).padStart(2, "0");

    return (
        `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` +
        ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

function walletRowHtml(transaction, balanceAfter) {
    const isDeposit = transaction.type === "deposit";

    return `
        <div class="record-row wallet-row">

            <span class="record-icon">
                ${isDeposit ? "⬇️" : "⬆️"}
            </span>

            <div class="record-info">

                <strong>
                    ${isDeposit ? "إيداع" : "صرف"}
                </strong>

                <span class="fuel-meta">
                    ${formatDateTime(transaction.date)}
                    • الرصيد بعدها ${currency(balanceAfter)}
                </span>

            </div>

            <strong class="record-amount ${isDeposit ? "wallet-plus" : "wallet-minus"}">
                ${isDeposit ? "+" : "-"}${formatNumber(transaction.amount)} د.ع
            </strong>

            <button
                type="button"
                class="delete-record"
                data-wallet-delete="${transaction.id}"
                aria-label="حذف الحركة"
            >
                🗑️
            </button>

        </div>
    `;
}

function renderWalletPage() {
    setText("walletBalanceValue", currency(walletBalance()));

    setText("walletAvailableValue", currency(availableBalance()));

    const list = $("walletLogList");

    if (!list) {
        return;
    }

    const ordered = getWalletTransactions()
        .slice()
        .sort((a, b) =>
            (new Date(a.date).getTime() || 0) -
            (new Date(b.date).getTime() || 0) ||
            (Number(a.id) || 0) - (Number(b.id) || 0)
        );

    let running = 0;

    const rows = ordered.map((transaction) => {

        const amount = numberValue(transaction.amount);

        running += transaction.type === "deposit" ? amount : -amount;

        return walletRowHtml(transaction, running);

    });

    list.innerHTML = rows.length
        ? rows.reverse().join("")
        : emptyListHtml("لا توجد عمليات في المحفظة بعد");
}

/* =========================================================
   HOME GROCERIES (المواد المنزلية)

   Every purchase is stored in month.homeExpenses - the same list
   (and the same cloud field) as the other home expenses - so it is
   part of the home total automatically:

     { id, kind: "grocery", group, subtype, title, quantity, unit,
       unitPrice, amount (= total), total, date, note }

   `group` is fruits | vegetables | meat | household.
========================================================= */

const GROCERY_CATEGORIES = {
    fruits: {
        label: "فواكه",
        icon: "🍎",
        namePlaceholder: "مثال: تفاح",
        defaultUnit: "كغم",
        units: ["كغم", "حبة", "حزمة", "علبة", "أخرى"],
        subtypes: null
    },

    vegetables: {
        label: "خضروات",
        icon: "🥬",
        namePlaceholder: "مثال: طماطم",
        defaultUnit: "كغم",
        units: ["كغم", "حبة", "حزمة", "علبة", "أخرى"],
        subtypes: null
    },

    meat: {
        label: "لحوم",
        icon: "🥩",
        namePlaceholder: "مثال: صدور دجاج",
        defaultUnit: "كغم",
        units: ["كغم", "قطعة", "علبة", "أخرى"],
        /* add more built-in kinds here; users can also add their own */
        subtypes: ["لحم", "دجاج", "سمك"]
    },

    household: {
        label: "مواد منزلية",
        icon: "🧴",
        namePlaceholder: "مثال: منظف أرضيات",
        defaultUnit: "قطعة",
        units: ["قطعة", "علبة", "كارتون", "لتر", "كغم", "أخرى"],
        subtypes: null
    }
};

let activeGroceryCategory = "fruits";
let activeGrocerySubtype = "all";

function isGroceryRecord(record) {
    return Boolean(
        record &&
        typeof record === "object" &&
        typeof record.group === "string" &&
        Object.prototype.hasOwnProperty.call(GROCERY_CATEGORIES, record.group)
    );
}

function getGroceryRecords(group) {
    return currentMonthData().homeExpenses.filter(
        (record) => isGroceryRecord(record) && record.group === group
    );
}

/* built-in kinds + any custom kind the user already used */
function grocerySubtypes(group) {
    const meta = GROCERY_CATEGORIES[group];

    if (!meta || !meta.subtypes) {
        return [];
    }

    const list = meta.subtypes.slice();

    getGroceryRecords(group).forEach((record) => {
        if (record.subtype && list.indexOf(record.subtype) === -1) {
            list.push(record.subtype);
        }
    });

    return list;
}

function openGroceryCategory(group) {
    if (!GROCERY_CATEGORIES[group]) {
        return;
    }

    activeGroceryCategory = group;
    activeGrocerySubtype = "all";

    renderGroceryCategoryPage();
    showPage("groceryCategoryPage");
}

function setGrocerySubtype(subtype) {
    activeGrocerySubtype = subtype || "all";

    renderGroceryCategoryPage();
}

function groceryTotalAll(month = currentMonthData()) {
    return sumOf(month.homeExpenses.filter(isGroceryRecord));
}

function renderGroceriesPage() {
    const month = currentMonthData();

    Object.keys(GROCERY_CATEGORIES).forEach((group) => {
        setText(
            `groceryTotal_${group}`,
            currency(
                sumOf(
                    month.homeExpenses.filter(
                        (record) =>
                            isGroceryRecord(record) && record.group === group
                    )
                )
            )
        );
    });

    setText("groceriesTotal", currency(groceryTotalAll(month)));
}

function groceryRowHtml(record, meta) {
    const quantity = record.quantity != null
        ? formatDecimals(record.quantity, 3)
        : "";

    const unit = record.unit ? ` ${escapeTaskHtml(record.unit)}` : "";

    const unitPrice = record.unitPrice != null
        ? ` × ${formatNumber(record.unitPrice)} د.ع`
        : "";

    const subtype = record.subtype
        ? `${escapeTaskHtml(record.subtype)} • `
        : "";

    const note = record.note
        ? ` • ${escapeTaskHtml(record.note)}`
        : "";

    return `
        <div class="record-row grocery-row">

            <span class="record-icon">
                ${meta.icon}
            </span>

            <div class="record-info">

                <strong>
                    ${escapeTaskHtml(record.title)}
                </strong>

                <span class="fuel-meta">
                    ${subtype}${quantity}${unit}${unitPrice}
                    • ${formatDate(record.date)}${note}
                </span>

            </div>

            <strong class="record-amount">
                ${currency(record.amount)}
            </strong>

            <button
                type="button"
                class="delete-record"
                data-delete="homeExpenses"
                data-delete-id="${record.id}"
                aria-label="حذف"
            >
                ×
            </button>

        </div>
    `;
}

function renderGroceryCategoryPage() {
    const meta = GROCERY_CATEGORIES[activeGroceryCategory];

    if (!meta) {
        return;
    }

    const records = getGroceryRecords(activeGroceryCategory);

    setText("groceryCategoryTitle", meta.label);
    setText("groceryCategoryTotalLabel", `إجمالي ${meta.label}`);
    setText("groceryCategoryTotal", currency(sumOf(records)));

    const tabs = $("groceryTypeTabs");

    if (tabs) {
        const subtypes = grocerySubtypes(activeGroceryCategory);

        if (!subtypes.length) {
            tabs.innerHTML = "";
        } else {
            tabs.innerHTML = ["all"]
                .concat(subtypes)
                .map((subtype) => `
                    <button
                        type="button"
                        class="grocery-chip ${subtype === activeGrocerySubtype ? "active" : ""}"
                        data-grocery-type="${escapeTaskHtml(subtype)}"
                    >
                        ${subtype === "all" ? "الكل" : escapeTaskHtml(subtype)}
                    </button>
                `)
                .join("");
        }
    }

    const filtered = activeGrocerySubtype === "all"
        ? records
        : records.filter((record) => record.subtype === activeGrocerySubtype);

    const list = $("groceryList");

    if (list) {
        list.innerHTML = filtered.length
            ? sortCarRecordsDesc(filtered)
                .map((record) => groceryRowHtml(record, meta))
                .join("")
            : emptyListHtml("لا توجد عمليات بعد");

        wireRecordRows(list, "homeExpenses");
    }
}

function groceryFormHtml(group) {
    const meta = GROCERY_CATEGORIES[group];

    const subtypes = grocerySubtypes(group);

    const unitOptions = meta.units
        .map((unit) => `
            <option value="${unit}" ${unit === meta.defaultUnit ? "selected" : ""}>
                ${unit}
            </option>
        `)
        .join("");

    const defaultSubtype = activeGrocerySubtype !== "all"
        ? activeGrocerySubtype
        : subtypes[0];

    const subtypeOptions = subtypes
        .map((subtype) => `
            <option value="${escapeTaskHtml(subtype)}" ${subtype === defaultSubtype ? "selected" : ""}>
                ${escapeTaskHtml(subtype)}
            </option>
        `)
        .join("");

    return `
        <h2 class="modal-title">إضافة ${meta.label}</h2>

        <form id="groceryForm" class="fuel-form" autocomplete="off">

            ${subtypes.length ? `
            <div class="form-group">

                <label for="grocerySubtype">
                    النوع
                </label>

                <select id="grocerySubtype">
                    ${subtypeOptions}
                    <option value="__new">+ نوع جديد</option>
                </select>

                <input
                    type="text"
                    id="grocerySubtypeNew"
                    class="hidden"
                    placeholder="اسم النوع الجديد"
                >

            </div>
            ` : ""}

            <div class="form-group">

                <label for="groceryName">
                    اسم الصنف
                </label>

                <input
                    type="text"
                    id="groceryName"
                    placeholder="${meta.namePlaceholder}"
                    required
                >

            </div>

            <div class="form-row">

                <div class="form-group">

                    <label for="groceryQuantity">
                        الكمية
                    </label>

                    <input
                        type="number"
                        id="groceryQuantity"
                        min="0"
                        step="0.01"
                        inputmode="decimal"
                        placeholder="0"
                        required
                    >

                </div>

                <div class="form-group">

                    <label for="groceryUnit">
                        الوحدة
                    </label>

                    <select id="groceryUnit">
                        ${unitOptions}
                    </select>

                </div>

            </div>

            <div class="form-group hidden" id="groceryUnitOtherGroup">

                <label for="groceryUnitOther">
                    اسم الوحدة
                </label>

                <input
                    type="text"
                    id="groceryUnitOther"
                    placeholder="مثال: ربطة"
                >

            </div>

            <div class="form-group">

                <label for="groceryUnitPrice">
                    سعر الوحدة (د.ع)
                </label>

                <input
                    type="text"
                    id="groceryUnitPrice"
                    inputmode="numeric"
                    placeholder="0"
                    data-money
                    required
                >

            </div>

            <div class="form-group">

                <label for="groceryTotal">
                    الإجمالي (د.ع)
                </label>

                <input
                    type="text"
                    id="groceryTotal"
                    placeholder="0"
                    readonly
                >

            </div>

            <div class="form-group">

                <label for="groceryDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="groceryDate"
                    required
                >

            </div>

            <div class="form-group">

                <label for="groceryNote">
                    ملاحظات (اختياري)
                </label>

                <input
                    type="text"
                    id="groceryNote"
                    placeholder="ملاحظة..."
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
    `;
}

/* total = quantity x unit price (display only; saved as numbers) */
function groceryComputedTotal() {
    const quantity = parseDecimal($("groceryQuantity")?.value);
    const unitPrice = numberValue($("groceryUnitPrice")?.value);

    return Math.round(quantity * unitPrice);
}

function recomputeGroceryTotal() {
    const totalInput = $("groceryTotal");

    if (totalInput) {
        totalInput.value = moneyInputValue(groceryComputedTotal());
    }
}

function groceryDateISO() {
    const value = $("groceryDate")?.value;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");

    if (!match) {
        return new Date().toISOString();
    }

    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        12
    ).toISOString();
}

/*
    Pure validation + record builder (no DOM).
    Returns { ok: true, record } or { ok: false, message }.
*/
function buildGroceryRecord({
    group,
    name,
    subtype = "",
    quantity,
    unit,
    unitPrice,
    date,
    note = ""
}) {
    const meta = GROCERY_CATEGORIES[group];

    if (!meta) {
        return { ok: false, message: "قسم غير معروف" };
    }

    const title = String(name || "").trim();

    if (!title) {
        return { ok: false, message: "أدخل اسم الصنف" };
    }

    const amountQuantity = parseDecimal(quantity);

    if (amountQuantity <= 0) {
        return { ok: false, message: "أدخل كمية صحيحة" };
    }

    const price = numberValue(unitPrice);

    if (price <= 0) {
        return { ok: false, message: "أدخل سعر الوحدة" };
    }

    const total = Math.round(amountQuantity * price);

    if (total <= 0) {
        return { ok: false, message: "الإجمالي غير صحيح" };
    }

    if (meta.subtypes && !String(subtype || "").trim()) {
        return { ok: false, message: "اختر النوع" };
    }

    return {
        ok: true,
        record: {
            id: Date.now() + Math.floor(Math.random() * 100000),
            kind: "grocery",
            group,
            subtype: meta.subtypes ? String(subtype).trim() : "",
            title,
            quantity: roundDecimals(amountQuantity, 3),
            unit: String(unit || meta.defaultUnit).trim(),
            unitPrice: price,
            amount: total,
            total,
            date: date || new Date().toISOString(),
            note: String(note || "").trim()
        }
    };
}

function openGroceryModal() {
    if (isMonthClosed()) {
        showToast("🔒 شهر مغلق");
        return;
    }

    const group = activeGroceryCategory;

    const meta = GROCERY_CATEGORIES[group];

    if (!meta) {
        return;
    }

    openModal(groceryFormHtml(group));

    const dateInput = $("groceryDate");

    if (dateInput && !dateInput.value) {
        dateInput.value = todayDateInputValue();
    }

    $("groceryQuantity")?.addEventListener("input", recomputeGroceryTotal);
    $("groceryUnitPrice")?.addEventListener("input", recomputeGroceryTotal);

    $("groceryUnit")?.addEventListener(
        "change",
        () => {
            $("groceryUnitOtherGroup")?.classList.toggle(
                "hidden",
                $("groceryUnit")?.value !== "أخرى"
            );
        }
    );

    $("grocerySubtype")?.addEventListener(
        "change",
        () => {
            $("grocerySubtypeNew")?.classList.toggle(
                "hidden",
                $("grocerySubtype")?.value !== "__new"
            );
        }
    );

    $("groceryForm")?.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            let subtype = $("grocerySubtype")?.value || "";

            if (subtype === "__new") {
                subtype = $("grocerySubtypeNew")?.value || "";
            }

            let unit = $("groceryUnit")?.value || meta.defaultUnit;

            if (unit === "أخرى") {
                unit = $("groceryUnitOther")?.value?.trim() || "";

                if (!unit) {
                    showToast("اكتب اسم الوحدة");
                    return;
                }
            }

            const result = buildGroceryRecord({
                group,
                name: $("groceryName")?.value,
                subtype,
                quantity: $("groceryQuantity")?.value,
                unit,
                unitPrice: $("groceryUnitPrice")?.value,
                date: groceryDateISO(),
                note: $("groceryNote")?.value
            });

            if (!result.ok) {
                showToast(result.message);
                return;
            }

            currentMonthData().homeExpenses.push(result.record);

            commit();
            closeModal();
            showToast(`تمت إضافة ${meta.label}`);

        }
    );
}

function init() {
    ensureCurrentMonth();

    // Migrate old per-month savings into the cumulative ledger
    // (idempotent - safe to run on every load)

    migrateSavingsLedger();

    saveDatabase();

    loadTheme();

    updateMonthHeader();

    setupNavigation();

    setupMonthNavigation();

    setupModal();

    setupMoneyInputs();

    setupPageTabs();

    setupActions();

    renderAll();

    setupCloudSync();
}

init();








