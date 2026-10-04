/* =========================================================
   DAFTARI - المرحلة الخامسة والأخيرة: فحص شامل للمشروع
   (run with: node tests/phase5-acceptance.test.js)

   يغطي بنود 1-25 + الاختبارات العملية المطلوبة:
     1) 1,250,000 تظهر بالفواصل، الحساب صحيح، التخزين رقم لا نص
     2) سجل البنزين داخل قسم البنزين + بقاء البيانات القديمة
     3) المحفظة: 500,000 -> ايداع 100,000 -> صرف 30,000 -> 570,000
     4) البيت: 10,000 + 15,000 + 40,000 + 20,000 = 85,000
     5) كل اختبارات المشروع تمر + script.js بلا أخطاء
========================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT_SOURCE = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
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
        attributes,

        classList: {
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            contains: (name) => classes.has(name),
            toggle: (name, force) => {
                const add = force === undefined
                    ? !classes.has(name)
                    : Boolean(force);

                if (add) { classes.add(name); } else { classes.delete(name); }

                return add;
            }
        },

        addEventListener(type, handler) {
            (listeners[type] = listeners[type] || []).push(handler);
        },

        removeEventListener() {},

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

        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        appendChild(child) {
            element.children.push(child);

            return child;
        },

        remove() {},
        focus() {},
        contains: () => false
    };

    Object.defineProperty(element, "innerHTML", {
        get() { return html; },
        set(value) {
            if (registry) {
                (html.match(/id="[^"]+"/g) || [])
                    .forEach((token) => registry.delete(token.slice(4, -1)));
            }

            html = String(value);
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

function seedDatabase(database) {
    const store = {};
    store[STORAGE_KEY] = JSON.stringify(database);

    return store;
}

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
            setItem: (key, value) => { store.set(key, String(value)); },
            removeItem: (key) => { store.delete(key); }
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
            ensureCurrentMonth,
            monthKey,
            numberValue,
            parseDecimal,
            formatNumber,
            currency,
            formatMoneyInput,
            moneyInputValue,
            sumOf,
            saveDatabase,
            commit,
            renderAll,
            renderExpensesPage,
            renderCarPage,
            renderHomePage,
            renderHomeExpensesPage,
            renderGroceriesPage,
            renderGroceryCategoryPage,
            walletBalance,
            walletNetForMonth,
            availableBalance,
            addWalletTransaction,
            getWalletTransactions,
            getSalary,
            monthFinance,
            fixedExpensesTotal,
            buildGroceryRecord,
            getGroceryRecords,
            openGroceryCategory,
            openGroceryModal,
            isGroceryRecord,
            groceryTotalAll,
            GROCERY_CATEGORIES,
            getFuelRecords,
            setMonth: (year, month) => {
                currentYear = year;
                currentMonth = month;
                ensureCurrentMonth();
            }
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
            getElement: (id) => document.getElementById(id),
            raw: () => (store.has(STORAGE_KEY) ? store.get(STORAGE_KEY) : null)
        },
        sandbox.__daftari
    );
}

/* حقل مبلغ يتصرّف كحقل حقيقي أثناء الكتابة */
function fakeInput(value, caret) {
    const input = {
        value,
        selectionStart: caret === undefined ? value.length : caret,
        setSelectionRange(start) { input.selectionStart = start; }
    };

    return input;
}

function typeNumber(app, digits) {
    const input = fakeInput("", 0);

    String(digits).split("").forEach((digit) => {
        input.value =
            input.value.slice(0, input.selectionStart) +
            digit +
            input.value.slice(input.selectionStart);

        input.selectionStart += 1;

        app.formatMoneyInput(input);
    });

    return input;
}

function monthSeed(extra = {}) {
    const now = new Date();
    const key =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    return {
        [STORAGE_KEY]: JSON.stringify({
            months: {
                [key]: Object.assign(
                    {
                        year: now.getFullYear(),
                        month: now.getMonth(),
                        settings: {},
                        expenses: [],
                        carExpenses: [],
                        homeExpenses: [],
                        tasks: []
                    },
                    extra
                )
            },
            savingsLedger: {
                transactions: [],
                debtors: [],
                walletTransactions: []
            }
        })
    };
}

/* ============ 1) الفواصل + حساب بأرقام صحيحة + تخزين رقم ============ */
function testMoneyAndStorage() {
    console.log("\n1) الفواصل أثناء الإدخال + حساب صحيح + التخزين رقم لا نص");

    const app = createApp();

    check(typeNumber(app, 1000).value === "1,000", "كتابة 1000 تظهر 1,000");
    check(
        typeNumber(app, 100000).value === "100,000",
        "كتابة 100000 تظهر 100,000"
    );
    check(
        typeNumber(app, 1250000).value === "1,250,000",
        "كتابة 1250000 تظهر 1,250,000 (المبلغ المطلوب)"
    );

    check(
        app.numberValue("1,250,000") === 1250000,
        "numberValue يتجاهل الفواصل في الحساب"
    );

    check(
        app.parseDecimal("1,250.5") === 1250.5,
        "parseDecimal يتجاهل الفواصل"
    );

    check(
        app.moneyInputValue(1250000) === "1,250,000",
        "المبلغ المحفوظ يظهر بالفواصل"
    );

    /* الإدخال عبر النافذة نفسها */
    const app2 = createApp();

    app2.openGroceryCategory("fruits");
    app2.openGroceryModal();

    app2.getElement("groceryName").value = "تفاح";
    app2.getElement("groceryQuantity").value = "2";
    app2.getElement("groceryUnitPrice").value = "1,250,000";
    app2.getElement("groceryUnitPrice").dispatch("input");

    check(
        app2.getElement("groceryTotal").value === "2,500,000",
        "الإجمالي التلقائي: 2 × 1,250,000 = 2,500,000"
    );

    app2.getElement("groceryForm").dispatch("submit", { preventDefault() {} });

    const record = app2.currentMonthData().homeExpenses.slice(-1)[0];

    check(
        record.unitPrice === 1250000 && typeof record.unitPrice === "number",
        "سعر الوحدة مخزّن رقم 1250000 (typeof number)"
    );

    check(
        record.amount === 2500000 && typeof record.amount === "number",
        "الإجمالي مخزّن رقم 2500000 (typeof number)"
    );

    const raw = app2.raw();

    check(raw.indexOf("1,250,000") === -1, "لا يوجد نص بالفواصل داخل التخزين");
    check(
        raw.indexOf('"unitPrice":1250000') !== -1,
        "التخزين يحتوي 1250000 كرقم خام"
    );
}

/* ============ 2) سجل البنزين داخل قسم البنزين ============ */
function testFuelLog() {
    console.log("\n2) سجل البنزين داخل قسم البنزين + بقاء البيانات القديمة");

    const now = new Date().toISOString();

    const app = createApp(monthSeed({
        carExpenses: [
            {
                id: 1,
                kind: "fuel",
                title: "تعبئة بنزين",
                amount: 45000,
                total: 45000,
                liters: 100,
                pricePerLiter: 450,
                fuelType: "normal",
                date: now
            },
            { id: 2, kind: "fuel", title: "بنزين قديم", amount: 30000, date: now },
            { id: 3, title: "صيانة", amount: 20000, date: now }
        ]
    }));

    app.renderCarPage();

    const fuel = app.getElement("fuelRecordsList").innerHTML;
    const other = app.getElement("carExpensesList").innerHTML;

    check(fuel.indexOf("تعبئة بنزين") !== -1, "السجل الجديد داخل قسم البنزين");
    check(
        fuel.indexOf("30,000") !== -1,
        "بيانات البنزين القديمة (30,000) لم تختفِ"
    );
    check(other.indexOf("تعبئة بنزين") === -1, "البنزين لا يتكرر في سجل الصيانة");
    check(other.indexOf("صيانة") !== -1, "سجل الصيانة لم يتأثر");
    check(
        app.getFuelRecords().length === 2,
        "عدد سجلات البنزين = 2 (جديد + قديم)"
    );
}

/* ============ 3) المحفظة: 500,000 + 100,000 - 30,000 ============ */
function testWalletScenario() {
    console.log("\n3) المحفظة: 500,000 -> ايداع 100,000 -> صرف 30,000 -> 570,000");

    const app = createApp(monthSeed({
        settings: { salary: 1000000 }
    }));

    /* رصيد افتتاحي 500,000 من إيداع سابق */
    app.sandbox.addWalletTransaction("deposit", 500000);

    check(app.walletBalance() === 500000, "الرصيد الافتتاحي = 500,000");

    /* المصروفات الثابتة تأخذ قيمها الافتراضية، لذلك نقارن بالنسبة */
    const month = app.currentMonthData();
    const fixed = app.fixedExpensesTotal(month);
    const baseAvailable = app.availableBalance();

    check(
        app.walletNetForMonth(app.monthKey()) === 500000,
        "صافي المحفظة لهذا الشهر = 500,000"
    );

    check(
        baseAvailable ===
            app.getSalary(month) - fixed - 500000,
        "الرصيد المتاح = الراتب - الثابت - 500,000"
    );

    /* ايداع 100,000 */
    const deposit = app.addWalletTransaction("deposit", 100000);

    check(deposit.ok === true, "ايداع 100,000 ناجح");
    check(deposit.transaction.type === "deposit", "نوع العملية deposit");
    check(deposit.transaction.amount === 100000, "مبلغ الايداع 100,000");
    check(app.walletBalance() === 600000, "الرصيد بعد الايداع = 600,000");
    check(
        app.availableBalance() === baseAvailable - 100000,
        "الرصيد المتاح انخفض 100,000 بعد الايداع"
    );

    /* صرف 30,000 */
    const withdraw = app.addWalletTransaction("withdraw", 30000);

    check(withdraw.ok === true, "صرف 30,000 ناجح");
    check(withdraw.transaction.type === "withdraw", "نوع العملية withdraw");
    check(app.walletBalance() === 570000, "الرصيد النهائي = 570,000");
    check(
        app.availableBalance() === baseAvailable - 100000 + 30000,
        "الرصيد المتاح ارتفع 30,000 بعد الصرف"
    );

    /* صرف أكبر من الرصيد */
    const tooMuch = app.addWalletTransaction("withdraw", 1000000);

    check(tooMuch.ok === false, "صرف 1,000,000 من 570,000 مرفوض");
    check(
        tooMuch.message === "رصيد المحفظة غير كافٍ.",
        "رسالة الرفض: 'رصيد المحفظة غير كافٍ.'"
    );
    check(app.walletBalance() === 570000, "الرصيد لم يتغير بعد الرفض");
    check(
        app.getWalletTransactions().length === 3,
        "3 عمليات مسجّلة فقط (المرفوضة لا تُحفظ)"
    );

    /* التخزين */
    app.saveDatabase();

    const saved = JSON.parse(app.raw());

    check(
        Array.isArray(saved.savingsLedger.walletTransactions) &&
            saved.savingsLedger.walletTransactions.length === 3,
        "عمليات المحفظة محفوظة في savingsLedger"
    );

    check(
        saved.savingsLedger.walletTransactions.every(
            (t) => typeof t.amount === "number"
        ),
        "مبالغ المحفظة مخزّنة كأرقام"
    );
}

/* ============ 4) البيت: 10,000 + 15,000 + 40,000 + 20,000 = 85,000 ============ */
function testHomeScenario() {
    console.log("\n4) البيت: فواكه 10,000 + خضروات 15,000 + لحوم 40,000 + مواد 20,000 = 85,000");

    const app = createApp(monthSeed({
        settings: { homeContribution: 500000, norhanContribution: 500000 }
    }));

    /* مصروف بيت قديم بدون group: يجب أن يبقى محسوباً ومعروضاً */
    app.currentMonthData().homeExpenses.push({
        id: 900,
        title: "صيانة سباكة",
        amount: 30000,
        date: new Date().toISOString()
    });

    function add(group, values) {
        const result = app.buildGroceryRecord(
            Object.assign({ group }, values)
        );

        if (!result.ok) {
            throw new Error("بناء فشل: " + result.message);
        }

        app.currentMonthData().homeExpenses.push(result.record);

        return result.record;
    }

    const apple = add("fruits", {
        name: "تفاح", quantity: 2, unit: "كغم", unitPrice: 5000
    });

    const tomato = add("vegetables", {
        name: "طماطم", quantity: 3, unit: "كغم", unitPrice: 5000
    });

    const meat = add("meat", {
        subtype: "لحم", name: "لحم غنم", quantity: 4, unit: "كغم", unitPrice: 10000
    });

    const soap = add("household", {
        name: "صابون", quantity: 2, unit: "قطعة", unitPrice: 10000
    });

    /* 16) الكميات والأسعار تحسب الإجمالي */
    check(apple.amount === 10000, "فواكه: 2 × 5,000 = 10,000");
    check(tomato.amount === 15000, "خضروات: 3 × 5,000 = 15,000");
    check(meat.amount === 40000, "لحوم: 4 × 10,000 = 40,000");
    check(soap.amount === 20000, "مواد منزلية: 2 × 10,000 = 20,000");

    check(app.groceryTotalAll() === 85000, "إجمالي المواد المنزلية = 85,000");

    app.renderAll();

    /* إجماليات كل قسم */
    check(
        app.getElement("groceriesTotal").textContent === app.currency(85000),
        "صفحة المواد المنزلية تعرض 85,000"
    );

    check(
        app.getElement("homeGroceriesTotal").textContent === app.currency(85000),
        "بطاقة البيت تعرض 85,000"
    );

    [
        ["fruits", 10000],
        ["vegetables", 15000],
        ["meat", 40000],
        ["household", 20000]
    ].forEach(([group, total]) => {
        check(
            app.getElement(`groceryTotal_${group}`).textContent ===
                app.currency(total),
            `إجمالي ${group} = ${app.formatNumber(total)}`
        );
    });

    /* 17) الإجمالي يدخل ضمن مصروف البيت */
    const homeExpenses = app.currentMonthData().homeExpenses;

    check(
        app.sumOf(homeExpenses) === 115000,
        "قائمة مصروفات البيت = 85,000 + 30,000 (قديمة) = 115,000"
    );

    check(
        app.getElement("homeTotalExpenses").textContent ===
            app.currency(115000),
        "إجمالي مصروفات البيت يشمل المواد الجديدة"
    );

    check(
        homeExpenses.every((r) => typeof r.amount === "number"),
        "كل مبالغ البيت مخزّنة كأرقام"
    );

    /* مصاريف البيت القديمة ما زالت تعمل */
    check(
        app.getElement("homeExpensesList").innerHTML.indexOf("صيانة سباكة") !== -1,
        "مصاريف البيت القديمة ما زالت ظاهرة"
    );

    check(
        app.getElement("homeExpensesList").innerHTML.indexOf("تفاح") === -1,
        "المواد لا تتكرر في قائمة مصاريف البيت العامة"
    );

    /* 10-15) الأقسام واللحوم */
    app.openGroceryCategory("meat");
    app.renderGroceryCategoryPage();

    const chips = app.getElement("groceryTypeTabs").innerHTML;

    check(chips.indexOf("لحم") !== -1, "اللحوم: تبويب لحم");
    check(chips.indexOf("دجاج") !== -1, "اللحوم: تبويب دجاج");
    check(chips.indexOf("سمك") !== -1, "اللحوم: تبويب سمك");

    /* دجاج وسمك عبر النافذة */
    function viaModal(group, subtype, name, quantity, price) {
        app.openGroceryCategory(group);
        app.openGroceryModal();

        if (subtype) {
            app.getElement("grocerySubtype").value = subtype;
        }

        app.getElement("groceryName").value = name;
        app.getElement("groceryQuantity").value = String(quantity);
        app.getElement("groceryUnitPrice").value = String(price);
        app.getElement("groceryUnitPrice").dispatch("input");
        app.getElement("groceryForm").dispatch("submit", { preventDefault() {} });
    }

    viaModal("meat", "دجاج", "دجاج", 2, 8000);

    check(
        app.getGroceryRecords("meat").some((r) => r.subtype === "دجاج"),
        "دجاج يعمل (2 × 8,000)"
    );

    viaModal("meat", "سمك", "سمك", 3, 7500);

    check(
        app.getGroceryRecords("meat").some((r) => r.subtype === "سمك"),
        "سمك يعمل (3 × 7,500)"
    );

    check(
        app.groceryTotalAll() === 123500,
        "الإجمالي بعد دجاج وسمك = 85,000 + 16,000 + 22,500 = 123,500"
    );

    check(
        app.getGroceryRecords("fruits").length === 1 &&
            app.getGroceryRecords("vegetables").length === 1 &&
            app.getGroceryRecords("household").length === 1,
        "كل قسم منفصل عن الآخر"
    );
}

/* ============ 5) تغيير الشهر + عدم وجود أخطاء JavaScript ============ */
function testMonthSwitch() {
    console.log("\n5) تغيير الشهر + idempotency بلا أخطاء");

    const app = createApp();

    app.addWalletTransaction("deposit", 570000);

    app.currentMonthData().homeExpenses.push(
        app.buildGroceryRecord({
            group: "fruits",
            name: "تفاح",
            quantity: 2,
            unit: "كغم",
            unitPrice: 5000
        }).record
    );

    app.commit();

    check(app.walletBalance() === 570000, "قبل تغيير الشهر: المحفظة 570,000");
    check(app.groceryTotalAll() === 10000, "قبل تغيير الشهر: الفواكه 10,000");

    const now = new Date();
    const otherMonth = now.getMonth() === 0 ? 1 : 0;

    app.setMonth(now.getFullYear(), otherMonth);

    check(
        app.walletBalance() === 570000,
        "المحفظة تراكمية: لم تُصفّر عند تغيير الشهر"
    );

    app.setMonth(now.getFullYear(), now.getMonth());

    check(
        app.groceryTotalAll() === 10000,
        "بيانات الشهر الأصلي سليمة بعد الرجوع"
    );

    check(
        app.walletBalance() === 570000,
        "المحفظة سليمة بعد الرجوع للشهر الأصلي"
    );

    let error = null;

    try {
        app.renderAll();
        app.commit();
        app.renderAll();
        app.commit();
    } catch (e) {
        error = e;
    }

    check(error === null, "إعادة العرض والحفظ بلا أخطاء JavaScript");
}

/* ============ 6) كل اختبارات المشروع تمر ============ */
function testAllProjectTests() {
    console.log("\n6) بناء script.js + كل اختبارات المشروع");

    let syntaxOk = true;

    try {
        execFileSync(
            process.execPath,
            ["--check", path.join(ROOT, "script.js")],
            { stdio: "pipe" }
        );
    } catch (e) {
        syntaxOk = false;
    }

    check(syntaxOk, "script.js بلا أخطاء بناء (node --check)");

    [
        "sync.test.js",
        "retry.test.js",
        "car-parts.test.js",
        "wallet-home.test.js",
        "groceries-html.test.js",
        "wallet.test.js",
        "tasks.test.js",
        "savings-remaining.test.js",
        "savings-log.test.js"
    ].forEach((file) => {
        let ok = false;

        try {
            execFileSync(
                process.execPath,
                [path.join(ROOT, "tests", file)],
                { stdio: "pipe" }
            );

            ok = true;
        } catch (e) {
            ok = false;
        }

        check(ok, `tests/${file} يمر بنجاح`);
    });
}

console.log("DAFTARI - المرحلة الخامسة: فحص شامل للمشروع");

try {
    testMoneyAndStorage();

    testFuelLog();

    testWalletScenario();

    testHomeScenario();

    testMonthSwitch();

    testAllProjectTests();
} catch (error) {
    failed += 1;

    console.error("\nUnexpected error:");
    console.error(error);
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);