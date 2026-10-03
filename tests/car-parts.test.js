/* =========================================================
   DAFTARI - car parts tests (run with: node tests/car-parts.test.js)

   قسم "الزيوت والفلاتر والبطارية" داخل صفحة السيارة:

     1) نموذج لكل نوع (نوع / كمية للزيوت / سعر / تاريخ)
     2) حفظ كل سجل بتاريخه داخل سجلات الشهر
     3) ظهور السجلات ضمن قائمة مصاريف السيارة
     4) عدم حذف السجلات القديمة (توافق للخلف)

   script.js يعمل داخل DOM وهمي بسيط، بدون متصفح.
========================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SCRIPT_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
);

const HTML_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8"
);

const STORAGE_KEY = "daftari_v2";

let passed = 0;
let failed = 0;

function check(condition, label) {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${label}`);
    } else {
        failed += 1;
        console.log(`  FAIL ${label}`);
    }
}

/* =========================================================
   FAKE DOM (يكفي لتشغيل script.js)
========================================================= */

function createElement(tag = "div", registry = null) {
    const classes = new Set();
    const listeners = {};
    const attributes = {};

    let html = "";

    const element = {
        tagName: String(tag).toUpperCase(),
        id: "",
        textContent: "",
        value: "",
        disabled: false,
        checked: false,
        children: [],
        dataset: {},
        style: {},

        classList: {
            add: (...names) => {
                names.forEach((name) => classes.add(name));
            },
            remove: (...names) => {
                names.forEach((name) => classes.delete(name));
            },
            contains: (name) => classes.has(name),
            toggle: (name, force) => {

                const add = force === undefined
                    ? !classes.has(name)
                    : Boolean(force);

                if (add) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }

                return add;
            }
        },

        addEventListener(type, handler) {
            if (!listeners[type]) {
                listeners[type] = [];
            }

            listeners[type].push(handler);
        },

        removeEventListener() {},

        hasListener(type) {
            return Boolean(listeners[type] && listeners[type].length);
        },

        dispatch(type, event) {
            (listeners[type] || []).forEach((handler) => handler(
                event || { type, target: element, preventDefault() {} }
            ));
        },

        setAttribute(name, value) {
            attributes[name] = String(value);
        },

        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attributes, name)
                ? attributes[name]
                : null;
        },

        querySelector() {
            return null;
        },

        querySelectorAll() {
            return [];
        },

        closest() {
            return null;
        },

        appendChild(child) {
            element.children.push(child);

            return child;
        },

        remove() {},
        focus() {},
        contains() {
            return false;
        }
    };

    /*
        مثل DOM الحقيقي: إعادة إسناد innerHTML تُلغي العناصر
        القديمة (وبالتالي مستمعي أحداثها). هذا مطلوب لأن
        openModal() تستبدل محتوى النافذة في كل مرة.
    */
    Object.defineProperty(element, "innerHTML", {
        get() {
            return html;
        },
        set(value) {

            const next = String(value);

            if (registry) {
                (html.match(/id="[^"]+"/g) || []).forEach((token) => {
                    registry.delete(token.slice(4, -1));
                });
            }

            html = next;
        }
    });

    return element;
}

function createDocument() {
    const elements = new Map();

    const document = {
        body: createElement("body", elements),
        documentElement: createElement("html", elements),

        getElementById(id) {
            if (!elements.has(id)) {
                const element = createElement("div", elements);
                element.id = id;
                elements.set(id, element);
            }

            return elements.get(id);
        },

        querySelector: () => null,
        querySelectorAll: () => [],
        createElement,
        addEventListener() {},
        removeEventListener() {}
    };

    document.elements = elements;

    return document;
}

/* =========================================================
   APP (script.js داخل سياق vm مع DOM وهمي + localStorage)
========================================================= */

function createApp(storageSeed = {}) {
    const store = new Map(
        Object.entries(storageSeed).map(([key, value]) => [key, String(value)])
    );

    const document = createDocument();

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        JSON,
        Math,
        Date,
        document,
        window: {
            scrollTo() {},
            addEventListener() {},
            location: { origin: "https://daftari.test" }
        },
        navigator: { onLine: true },
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => {
                store.set(key, String(value));
            },
            removeItem: (key) => {
                store.delete(key);
            }
        }
    };

    sandbox.window.document = document;

    vm.createContext(sandbox);
    vm.runInContext(SCRIPT_SOURCE, sandbox, { filename: "script.js" });

    vm.runInContext(
        `
        globalThis.__daftari = {
            getDatabase: () => database,
            currentMonthData,
            monthKey,
            carPartMeta,
            carPartFormHtml,
            openCarPartModal,
            getCarPartRecords,
            sortCarRecordsDesc,
            carPartLastChangeText,
            renderCarPage,
            CAR_PART_TYPES,
            formatDate,
            currency,
            todayDateInputValue
        };
        `,
        sandbox,
        { filename: "expose.js" }
    );

    return Object.assign(
        {
            sandbox,
            document,
            store,
            getElement: (id) => document.getElementById(id)
        },
        sandbox.__daftari
    );
}

/* تواريخ الاختبار داخل الشهر الحالي حتى تُحفظ في سجلات الشهر */
function currentMonthKey() {
    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthDay(day) {
    return `${currentMonthKey()}-${String(day).padStart(2, "0")}`;
}

function fillAndSubmit(app, kind, values) {
    app.openCarPartModal(kind);

    const typeInput = app.getElement("carPartType");
    const quantityInput = app.getElement("carPartQuantity");
    const amountInput = app.getElement("carPartAmount");
    const noteInput = app.getElement("carPartNote");
    const dateInput = app.getElement("carPartDate");

    if (values.type !== undefined) {
        typeInput.value = values.type;
    }

    if (values.quantity !== undefined) {
        quantityInput.value = String(values.quantity);
    }

    if (values.amount !== undefined) {
        amountInput.value = String(values.amount);
    }

    if (values.note !== undefined) {
        noteInput.value = values.note;
    }

    if (values.date !== undefined) {
        dateInput.value = values.date;
    }

    app.getElement("carPartForm").dispatch("submit", {
        preventDefault() {}
    });
}

/* =========================================================
   1) index.html + الأنواع الثلاثة
========================================================= */

function testMarkupAndTypes() {
    console.log("\n1) index.html + الأنواع الثلاثة");

    check(
        HTML_SOURCE.indexOf("الزيوت والفلاتر والبطارية") !== -1,
        "index.html: قسم السيارة يحمل اسم 'الزيوت والفلاتر والبطارية'"
    );

    [
        "carOilButton",
        "carFilterButton",
        "carBatteryButton",
        "carPartsTotal",
        "oilTotalAmount",
        "filterTotalAmount",
        "batteryTotalAmount",
        "oilLastChange",
        "filterLastChange",
        "batteryLastChange"
    ].forEach((id) => check(
        HTML_SOURCE.indexOf(`id="${id}"`) !== -1,
        `index.html: العنصر #${id} موجود`
    ));

    const app = createApp();
    const types = app.CAR_PART_TYPES;

    check(types.oil.icon === "🛢️", "الزيوت: الأيقونة 🛢️");
    check(types.filter.icon === "🔧", "الفلاتر: الأيقونة 🔧");
    check(types.battery.icon === "🔋", "البطارية: الأيقونة 🔋");

    check(
        types.oil.quantity === true &&
        types.filter.quantity === false &&
        types.battery.quantity === false,
        "الكمية مطلوبة للزيوت فقط"
    );

    return app;
}

/* =========================================================
   2) نماذج التسجيل
========================================================= */

function testForms(app) {
    console.log("\n2) نماذج التسجيل");

    const oilForm = app.carPartFormHtml("oil");

    ["نوع الزيت", "الكمية (لتر)", "السعر (د.ع)", "التاريخ"].forEach(
        (label) => check(
            oilForm.indexOf(label) !== -1,
            `نموذج الزيوت يحتوي: ${label}`
        )
    );

    const filterForm = app.carPartFormHtml("filter");

    check(
        filterForm.indexOf("نوع الفلتر") !== -1 &&
        filterForm.indexOf("السعر (د.ع)") !== -1 &&
        filterForm.indexOf("التاريخ") !== -1,
        "نموذج الفلاتر يحتوي: النوع + السعر + التاريخ"
    );

    check(
        filterForm.indexOf("carPartQuantity") === -1,
        "نموذج الفلاتر بدون حقل كمية"
    );

    const batteryForm = app.carPartFormHtml("battery");

    check(
        batteryForm.indexOf("نوع البطارية") !== -1 &&
        batteryForm.indexOf("carPartQuantity") === -1,
        "نموذج البطارية: النوع + السعر + التاريخ بدون كمية"
    );

    check(app.carPartMeta("bogus") === null, "نوع غير معروف يُرفض");
    check(app.carPartMeta("constructor") === null, "مفاتيح Object الموروثة تُرفض");
    check(app.carPartFormHtml("bogus") === "", "لا نموذج لنوع غير معروف");
}

/* =========================================================
   3) الحفظ بالتاريخ داخل سجلات الشهر
========================================================= */

function testSaving(app) {
    console.log("\n3) الحفظ بالتاريخ داخل سجلات الشهر");

    fillAndSubmit(app, "oil", {
        type: "زيت محرك 10W-40",
        quantity: 4,
        amount: 55000,
        note: "تغيير دوري",
        date: monthDay(5)
    });

    fillAndSubmit(app, "filter", {
        type: "فلتر زيت",
        amount: 15000,
        date: monthDay(20)
    });

    fillAndSubmit(app, "battery", {
        type: "بطارية 70 أمبير",
        amount: 120000,
        date: monthDay(12)
    });

    const month = app.currentMonthData();

    const oil = month.carExpenses.find((record) => record.kind === "oil");
    const filter = month.carExpenses.find((record) => record.kind === "filter");
    const battery = month.carExpenses.find((record) => record.kind === "battery");

    check(
        Boolean(oil) && Boolean(filter) && Boolean(battery),
        "السجلات الثلاثة محفوظة داخل سجلات الشهر"
    );

    check(oil.itemType === "زيت محرك 10W-40", "الزيوت: النوع محفوظ");
    check(oil.quantity === 4 && oil.unit === "لتر", "الزيوت: الكمية (4 لتر) محفوظة");
    check(oil.amount === 55000 && oil.total === 55000, "الزيوت: السعر محفوظ");
    check(oil.date.slice(0, 10) === monthDay(5), "الزيوت: التاريخ محفوظ بصيغة ISO");
    check(oil.note === "تغيير دوري", "الزيوت: الملاحظة محفوظة");
    check(oil.title.indexOf("زيت محرك 10W-40") !== -1, "الزيوت: العنوان يحتوي النوع");

    check(
        filter.itemType === "فلتر زيت" && filter.amount === 15000,
        "الفلاتر: النوع والسعر محفوظان"
    );
    check(filter.date.slice(0, 10) === monthDay(20), "الفلاتر: التاريخ محفوظ");
    check(filter.quantity === undefined, "الفلاتر: لا حقل كمية في السجل");

    check(
        battery.itemType === "بطارية 70 أمبير" && battery.amount === 120000,
        "البطارية: النوع والسعر محفوظان"
    );
    check(battery.date.slice(0, 10) === monthDay(12), "البطارية: التاريخ محفوظ");

    const saved = JSON.parse(app.store.get(STORAGE_KEY));
    const savedMonth = saved.months[app.monthKey()];

    check(
        savedMonth.carExpenses.length === 3,
        "الحفظ المحلي: السجلات الثلاثة موجودة في localStorage"
    );

    const before = month.carExpenses.length;

    fillAndSubmit(app, "oil", {
        type: "زيت محرك 5W-30",
        quantity: 0,
        amount: 40000,
        date: monthDay(6)
    });

    check(month.carExpenses.length === before, "التحقق: الزيوت بدون كمية مرفوضة");

    fillAndSubmit(app, "battery", {
        type: "بطارية 60 أمبير",
        amount: 0,
        date: monthDay(6)
    });

    check(month.carExpenses.length === before, "التحقق: البطارية بدون سعر مرفوضة");

    fillAndSubmit(app, "filter", {
        type: "   ",
        amount: 9000,
        date: monthDay(6)
    });

    check(month.carExpenses.length === before, "التحقق: الفلاتر بدون نوع مرفوضة");

    return { month, oil, filter, battery };
}

/* =========================================================
   4) الظهور في سجلات الشهر + الإجماليات
========================================================= */

function testRendering(app, records) {
    console.log("\n4) الظهور في سجلات الشهر + الإجماليات");

    fillAndSubmit(app, "oil", {
        type: "زيت محرك 5W-30",
        quantity: 3.5,
        amount: 48000,
        date: monthDay(25)
    });

    app.renderCarPage();

    const html = app.getElement("carExpensesList").innerHTML;

    check(
        html.indexOf("تغيير زيت — زيت محرك 10W-40") !== -1,
        "السجل: الزيوت تظهر في سجلات الشهر"
    );
    check(
        html.indexOf("تغيير فلتر — فلتر زيت") !== -1,
        "السجل: الفلاتر تظهر في سجلات الشهر"
    );
    check(
        html.indexOf("تغيير بطارية — بطارية 70 أمبير") !== -1,
        "السجل: البطارية تظهر في سجلات الشهر"
    );

    check(
        html.indexOf(app.formatDate(records.oil.date)) !== -1,
        "السجل: تاريخ الزيت ظاهر في الصف"
    );
    check(html.indexOf("4 لتر") !== -1, "السجل: كمية الزيت ظاهرة");
    check(html.indexOf(app.currency(55000)) !== -1, "السجل: سعر الزيت ظاهر");
    check(html.indexOf("تغيير دوري") !== -1, "السجل: الملاحظة ظاهرة");

    const newer = html.indexOf("تغيير زيت — زيت محرك 5W-30");
    const older = html.indexOf("تغيير زيت — زيت محرك 10W-40");

    check(
        newer !== -1 && older !== -1 && newer < older,
        "السجل: الأحدث أولاً حسب التاريخ"
    );

    check(
        app.getElement("oilTotalAmount").textContent === app.currency(103000),
        "الإجماليات: مجموع الزيوت"
    );
    check(
        app.getElement("filterTotalAmount").textContent === app.currency(15000),
        "الإجماليات: مجموع الفلاتر"
    );
    check(
        app.getElement("batteryTotalAmount").textContent === app.currency(120000),
        "الإجماليات: مجموع البطارية"
    );
    check(
        app.getElement("carPartsTotal").textContent === app.currency(238000),
        "الإجماليات: مجموع القسم كامل"
    );

    const newestOil = app.sortCarRecordsDesc(app.getCarPartRecords("oil"))[0];

    check(
        app.getElement("oilLastChange").textContent ===
            app.formatDate(newestOil.date),
        "آخر تغيير زيت = تاريخ أحدث سجل"
    );

    const month = app.currentMonthData();

    const expectedTotal = month.carExpenses.reduce(
        (sum, record) => sum + Number(record.amount || 0),
        0
    );

    check(
        app.getElement("carTotal").textContent === app.currency(expectedTotal),
        "الإجماليات: carTotal يشمل كل مصاريف السيارة"
    );
}

/* =========================================================
   5) إعادة التحميل + السجلات القديمة
========================================================= */

function testReloadAndLegacy() {
    console.log("\n5) إعادة التحميل + السجلات القديمة");

    const app = createApp();

    fillAndSubmit(app, "filter", {
        type: "فلتر هواء",
        amount: 20000,
        date: monthDay(3)
    });

    const savesdSource = app.store.get(STORAGE_KEY);

    const reloaded = createApp({ [STORAGE_KEY]: savesdSource });
    const reloadedMonth = reloaded.currentMonthData();
    const record = reloadedMonth.carExpenses[0];

    check(reloadedMonth.carExpenses.length === 1, "إعادة التحميل: السجل موجود");
    check(
        record.kind === "filter" &&
        record.itemType === "فلتر هواء" &&
        record.amount === 20000 &&
        record.date.slice(0, 10) === monthDay(3),
        "إعادة التحميل: النوع والسعر والتاريخ كما هي"
    );

    reloaded.renderCarPage();

    check(
        reloaded
            .getElement("carExpensesList")
            .innerHTML
            .indexOf("تغيير فلتر — فلتر هواء") !== -1,
        "إعادة التحميل: السجل يظهر في سجلات الشهر"
    );

    const legacyKey = currentMonthKey();

    const legacyApp = createApp({
        [STORAGE_KEY]: JSON.stringify({
            months: {
                [legacyKey]: {
                    year: Number(legacyKey.slice(0, 4)),
                    month: Number(legacyKey.slice(5, 7)) - 1,
                    settings: {},
                    savings: null,
                    expenses: [],
                    carExpenses: [
                        {
                            id: 1,
                            kind: "oil",
                            title: "زيت",
                            amount: 30000,
                            date: `${monthDay(2)}T00:00:00.000Z`
                        },
                        {
                            id: 2,
                            kind: "filter",
                            title: "فلتر",
                            amount: 12000,
                            date: `${monthDay(1)}T00:00:00.000Z`
                        },
                        {
                            id: 3,
                            kind: "battery",
                            title: "بطارية",
                            amount: 90000,
                            date: `${monthDay(3)}T00:00:00.000Z`
                        },
                        {
                            id: 4,
                            kind: "maintenance",
                            title: "صيانة عامة",
                            amount: 45000,
                            date: `${monthDay(4)}T00:00:00.000Z`
                        }
                    ],
                    homeExpenses: []
                }
            }
        })
    });

    check(
        legacyApp.currentMonthData().carExpenses.length === 4,
        "السجلات القديمة: لم تُحذف عند التحميل"
    );

    legacyApp.renderCarPage();

    const legacyHtml = legacyApp.getElement("carExpensesList").innerHTML;

    check(
        legacyHtml.indexOf("زيت") !== -1 &&
        legacyHtml.indexOf(legacyApp.currency(30000)) !== -1,
        "السجلات القديمة: سجل الزيت القديم ما زال ظاهراً"
    );
    check(
        legacyHtml.indexOf("صيانة عامة") !== -1,
        "السجلات القديمة: سجل الصيانة كما هو"
    );

    fillAndSubmit(legacyApp, "oil", {
        type: "زيت محرك 10W-30",
        quantity: 5,
        amount: 62000,
        date: monthDay(9)
    });

    check(
        legacyApp.currentMonthData().carExpenses.length === 5,
        "السجلات القديمة: سجل جديد يُضاف بدون حذف القديم"
    );
    check(
        legacyApp.getCarPartRecords("oil").length === 2,
        "السجلات القديمة: زيوت قديمة + جديدة = 2"
    );
    check(
        legacyApp.getElement("oilTotalAmount").textContent ===
            legacyApp.currency(92000),
        "السجلات القديمة: الإجماليات تشمل السجل القديم"
    );
}

/* =========================================================
   6) توافق المزامنة (نفس بنية month.carExpenses)
========================================================= */

function testSyncShape(app) {
    console.log("\n6) توافق المزامنة");

    const filter = app.getCarPartRecords("filter")[0];

    check(
        JSON.parse(JSON.stringify(filter)).itemType === "فلتر زيت",
        "المزامنة: سجل الفلتر قابل للتسلسل"
    );
    check(
        Object.keys(filter).every((key) => filter[key] !== undefined),
        "المزامنة: لا قيم undefined في السجل"
    );
    check(
        app
            .getCarPartRecords("oil")
            .every((item) => item.kind === "oil" && Number.isFinite(item.amount)),
        "المزامنة: كل سجلات الزيوت تحمل kind و amount"
    );
    check(
        app.currentMonthData().carExpenses.length === 4,
        "المزامنة: كل السجلات داخل month.carExpenses كما قبل"
    );
    check(
        typeof app.sandbox.openCarExpenseModal === "function",
        "المزامنة: نافذة مصاريف السيارة القديمة (صيانة) ما زالت موجودة"
    );
}

(function main() {
    console.log("DAFTARI - قسم الزيوت والفلاتر والبطارية");

    try {
        const app = testMarkupAndTypes();

        testForms(app);

        const records = testSaving(app);

        testRendering(app, records);

        testReloadAndLegacy();

        testSyncShape(app);

    } catch (error) {
        failed += 1;

        console.error("\nUnexpected test error:");
        console.error(error);
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    process.exit(failed > 0 ? 1 : 0);
})();





