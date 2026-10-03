/* =========================================================
   DAFTARI - tasks tests (run with: node tests/tasks.test.js)

   قسم المهام:

     1) القيم الافتراضية للمهام القديمة (توافق للخلف)
     2) المتأخرة + مهام اليوم + غدًا
     3) بطاقات الإحصائيات (كل / اليوم / المتأخرة / قيد التنفيذ / المكتملة)
     4) البحث والفلاتر (تعمل مع بعضها)
     5) الترتيب التلقائي للعرض
     6) إضافة مهمة / تعديلها بدون فقدان أي بيانات
     7) إكمال / إعادة فتح (بدون حذف)
     8) الحذف عبر تأكيد
     9) العرض + الحفظ في localStorage + توافق المهام القديمة

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
        مثل DOM الحقيقي: إعادة إسناد innerHTML تُلغي العناصر القديمة
        (وبالتالي مستمعي أحداثها). هذا مطلوب لأن openModal() تستبدل
        محتوى النافذة في كل مرة.
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
            saveDatabase,
            commit,
            currentMonthData,
            monthKey,
            ensureTasks,
            taskStats,
            applyQuickFilter,
            sortTasksForDisplay,
            taskSortRank,
            isTaskOverdue,
            isTaskToday,
            isTaskCompleted,
            taskStatusValue,
            taskPriorityValue,
            taskCategoryValue,
            taskDateBadge,
            taskViewState,
            taskRowHtml,
            taskFormHtml,
            taskListTasks,
            renderTasks,
            renderTaskToolbar,
            renderTaskList,
            openAddTaskModal,
            openEditTaskModal,
            bindTaskForm,
            readTaskRepeatForm,
            toggleTask,
            deleteTask,
            requestDeleteTask,
            toggleTaskStat,
            taskRepeatValue,
            isTaskRecurring,
            isTaskRepeatActive,
            taskRepeatLabel,
            taskRepeatUnitText,
            taskDateISO,
            addMonthsTaskDate,
            advanceTaskDate,
            nextTaskDate,
            taskSeriesId,
            spawnNextRecurringTask,
            TASK_PRIORITIES,
            TASK_STATUSES,
            TASK_CATEGORIES,
            TASK_LISTS,
            TASK_REPEAT_MODES,
            TASK_REPEAT_UNITS,
            todayDateInputValue,
            formatDate
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

/* =========================================================
   أدوات تواريخ الاختبار
========================================================= */

function currentMonthKey() {
    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function dayOffset(offset) {
    const d = new Date();

    d.setDate(d.getDate() + offset);

    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    return `${d.getFullYear()}-${month}-${day}`;
}

function makeTask(overrides = {}) {
    return Object.assign(
        {
            id: 1,
            listKey: "personalTasks",
            title: "مهمة",
            note: "",
            done: false,
            status: "new",
            date: dayOffset(0),
            time: "",
            priority: "medium",
            category: "personal"
        },
        overrides
    );
}

/* =========================================================
   1) توافق المهام القديمة (قيم افتراضية)
========================================================= */

function testLegacyDefaults(app) {
    console.log("\n1) توافق المهام القديمة (قيم افتراضية)");

    const legacyOpen = {
        id: 1,
        listKey: "personalTasks",
        title: "قديمة",
        note: "",
        done: false,
        date: "2026-01-05T10:00:00.000Z"
    };

    const legacyDone = {
        id: 2,
        listKey: "personalTasks",
        title: "منجزة",
        note: "",
        done: true,
        date: "2026-01-06T10:00:00.000Z"
    };

    check(app.taskStatusValue(legacyOpen) === "new", "قديمة غير منجزة -> جديدة");
    check(app.taskStatusValue(legacyDone) === "completed", "قديمة done -> مكتملة");
    check(app.taskPriorityValue(legacyOpen) === "medium", "بدون أولوية -> متوسطة");
    check(app.taskCategoryValue(legacyOpen) === "other", "بدون تصنيف -> أخرى");

    check(app.taskStatusValue({}) === "new", "كائن فارغ لا يسبب خطأ");
    check(app.taskPriorityValue(null) === "medium", "null لا يسبب خطأ");
    check(app.taskCategoryValue(undefined) === "other", "undefined لا يسبب خطأ");

    const row = app.taskRowHtml(legacyOpen);

    check(row.indexOf("قديمة") !== -1, "المهمة القديمة تُعرض بلا خطأ");
    check(row.indexOf("task-pri-medium") !== -1, "الأولوية الافتراضية ظاهرة");
    check(row.indexOf("task-state-new") !== -1, "الحالة الافتراضية ظاهرة");
}

/* =========================================================
   2) المتأخرة + اليوم + غدًا
========================================================= */

function testDates(app) {
    console.log("\n2) المتأخرة ومهام اليوم");

    const overdue = { id: 1, title: "متأخرة", done: false, date: dayOffset(-3) };
    const today = { id: 2, title: "اليوم", done: false, date: dayOffset(0) };
    const tomorrow = { id: 3, title: "غدًا", done: false, date: dayOffset(1) };
    const doneOverdue = { id: 4, title: "منجزة متأخرة", done: true, date: dayOffset(-3) };
    const noDate = { id: 5, title: "بلا تاريخ", done: false, date: "" };

    check(app.isTaskOverdue(overdue) === true, "قبل اليوم وغير مكتملة -> متأخرة");
    check(app.isTaskOverdue(today) === false, "تاريخ اليوم ليست متأخرة");
    check(app.isTaskOverdue(doneOverdue) === false, "المكتملة لا تكون متأخرة");
    check(app.isTaskOverdue(noDate) === false, "بدون تاريخ ليست متأخرة");
    check(app.isTaskToday(today) === true, "تاريخ اليوم -> اليوم");
    check(app.isTaskToday(tomorrow) === false, "غدًا ليست اليوم");
    check(app.isTaskToday(doneOverdue) === false, "المكتملة ليست ضمن مهام اليوم");

    check(app.taskDateBadge(overdue).text === "متأخرة", "شارة المتأخرة");
    check(app.taskDateBadge(today).text === "اليوم", "شارة اليوم");
    check(app.taskDateBadge(tomorrow).text === "غدًا", "شارة غدًا");
    check(app.taskDateBadge(noDate).text === "بدون تاريخ", "شارة بدون تاريخ");
    check(app.taskDateBadge(overdue).tone === "overdue", "لون المتأخرة");
}

/* =========================================================
   3) بطاقات الإحصائيات
========================================================= */

function testStats(app) {
    console.log("\n3) بطاقات الإحصائيات");

    const tasks = [
        { id: 1, title: "متأخرة", done: false, date: dayOffset(-2) },
        { id: 2, title: "اليوم", done: false, date: dayOffset(0) },
        { id: 3, title: "قيد التنفيذ", done: false, status: "inProgress", date: dayOffset(3) },
        { id: 4, title: "مكتملة", done: true, date: dayOffset(-1) },
        { id: 5, title: "بلا تاريخ", done: false, date: "" }
    ];

    const stats = app.taskStats(tasks);

    check(stats.all === 5, "كل المهام = 5");
    check(stats.today === 1, "مهام اليوم = 1");
    check(stats.overdue === 1, "المتأخرة = 1");
    check(stats.inProgress === 1, "قيد التنفيذ = 1");
    check(stats.completed === 1, "المكتملة = 1");
}

/* =========================================================
   4) نظام التكرار (التسمية + التاريخ التالي)
========================================================= */

function testRecurrenceRules(app) {
    console.log("\n4) نظام التكرار");

    /* --- بدون تكرار + المهام القديمة --- */

    const plain = makeTask({ id: 1, date: dayOffset(0) });

    check(app.taskRepeatValue(plain) === null, "بدون تكرار -> null");
    check(app.isTaskRecurring(plain) === false, "المهمة العادية غير متكررة");
    check(app.taskRepeatLabel(plain) === "", "لا شارة تكرار للمهمة العادية");
    check(app.nextTaskDate(plain) === null, "لا تاريخ تالية بدون تكرار");

    const legacy = { id: 2, title: "قديمة", done: false, date: dayOffset(0) };

    check(app.taskRepeatValue(legacy) === null, "مهمة قديمة بلا حقل repeat -> بدون تكرار");
    check(app.nextTaskDate(legacy) === null, "المهمة القديمة لا تولّد تكرارًا");

    /* --- التسميات --- */

    check(app.taskRepeatLabel(makeTask({ repeat: { mode: "daily" } })) === "يوميًا", "تسمية: يوميًا");
    check(app.taskRepeatLabel(makeTask({ repeat: { mode: "weekly" } })) === "أسبوعيًا", "تسمية: أسبوعيًا");
    check(app.taskRepeatLabel(makeTask({ repeat: { mode: "monthly" } })) === "شهريًا", "تسمية: شهريًا");
    check(app.taskRepeatLabel(makeTask({ repeat: { mode: "yearly" } })) === "سنويًا", "تسمية: سنويًا");
    check(
        app.taskRepeatLabel(makeTask({ repeat: { mode: "custom", interval: 2, unit: "day" } })) === "كل يومين",
        "تسمية: كل يومين"
    );
    check(
        app.taskRepeatLabel(makeTask({ repeat: { mode: "custom", interval: 3, unit: "week" } })) === "كل 3 أسابيع",
        "تسمية: كل 3 أسابيع"
    );
    check(
        app.taskRepeatLabel(makeTask({ repeat: { mode: "custom", interval: 2, unit: "month" } })) === "كل شهرين",
        "تسمية: كل شهرين"
    );

    /* --- التكرار المخصص يقبل قيماً غير صالحة بأمان --- */

    const badCustom = app.taskRepeatValue(
        makeTask({ repeat: { mode: "custom", interval: 0, unit: "rock" } })
    );

    check(badCustom.interval === 1 && badCustom.unit === "day", "مخصص غير صالح -> قيم افتراضية آمنة");

    /* --- التكرار الموقوف --- */

    const weekly = makeTask({ id: 3, date: dayOffset(0), repeat: { mode: "weekly" } });
    const stopped = makeTask({ id: 4, date: dayOffset(0), repeat: { mode: "weekly", active: false } });

    check(app.isTaskRepeatActive(weekly) === true, "حالة التكرار: مفعل");
    check(app.isTaskRepeatActive(stopped) === false, "حالة التكرار: موقوف");
    check(app.nextTaskDate(stopped) === null, "التكرار الموقوف لا يولّد تاريخ تالية");

    /* --- التاريخ التالي لكل نمط --- */

    check(
        app.taskDateISO(app.nextTaskDate(makeTask({ date: dayOffset(0), repeat: { mode: "daily" } }))) === dayOffset(1),
        "يوميًا: +1 يوم"
    );

    check(
        app.taskDateISO(app.nextTaskDate(weekly)) === dayOffset(7),
        "أسبوعيًا: +7 أيام بنفس اليوم"
    );

    check(
        app.taskDateISO(app.nextTaskDate(makeTask({ date: dayOffset(0), repeat: { mode: "custom", interval: 2, unit: "day" } }))) === dayOffset(2),
        "مخصص: كل يومين"
    );

    check(
        app.taskDateISO(app.nextTaskDate(makeTask({ date: dayOffset(0), repeat: { mode: "custom", interval: 3, unit: "week" } }))) === dayOffset(21),
        "مخصص: كل 3 أسابيع"
    );

    const today = new Date();
    const baseMonth = makeTask({ date: dayOffset(0), repeat: { mode: "custom", interval: 2, unit: "month" } });
    const expectedMonth = app.addMonthsTaskDate(
        new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        2
    );

    check(
        app.taskDateISO(app.nextTaskDate(baseMonth)) === app.taskDateISO(expectedMonth),
        "مخصص: كل شهرين"
    );

    /* --- الشهر والسنة مع أيام غير موجودة (تطبيع التاريخ) --- */

    const jan31 = new Date(2026, 0, 31);

    check(
        app.taskDateISO(app.addMonthsTaskDate(jan31, 1)) === "2026-02-28",
        "شهريًا: 31 يناير -> 28 فبراير (بدون خطأ)"
    );

    check(
        app.taskDateISO(app.addMonthsTaskDate(jan31, 12)) === "2027-01-31",
        "سنويًا: 31 يناير -> 31 يناير التالي"
    );

    check(
        app.taskDateISO(app.addMonthsTaskDate(new Date(2028, 1, 29), 12)) === "2029-02-28",
        "سنويًا: 29 فبراير كبيس -> 28 فبراير"
    );

    /* --- لحاق الموعد إذا تأخر التكرار عن اليوم --- */

    const lateDaily = makeTask({ date: dayOffset(-5), repeat: { mode: "daily" } });

    check(
        app.taskDateISO(app.nextTaskDate(lateDaily)) >= dayOffset(0),
        "تكرار متأخر يتم لحاقه حتى اليوم"
    );
}

/* =========================================================
   5) الترتيب التلقائي للعرض
========================================================= */

function testSorting(app) {
    console.log("\n5) ترتيب المهام للعرض");

    const tasks = [
        { id: 1, title: "بلا تاريخ", done: false, date: "" },
        { id: 2, title: "قادمة", done: false, date: dayOffset(5) },
        { id: 3, title: "اليوم", done: false, date: dayOffset(0) },
        { id: 4, title: "عالية", done: false, priority: "high", date: dayOffset(5) },
        { id: 5, title: "متأخرة", done: false, date: dayOffset(-2) },
        { id: 6, title: "مكتملة", done: true, date: dayOffset(-1) }
    ];

    const order = app.sortTasksForDisplay(tasks).map((task) => task.title);

    check(order[0] === "متأخرة", "1) المتأخرة أولاً");
    check(order[1] === "عالية", "2) ثم الأولوية العالية/العاجلة");
    check(order[2] === "اليوم", "3) ثم مهام اليوم");
    check(order[3] === "قادمة", "4) ثم القادمة حسب التاريخ");
    check(order[4] === "بلا تاريخ", "5) ثم بدون تاريخ");
    check(order[5] === "مكتملة", "6) المكتملة أخيراً");

    check(tasks[0].title === "بلا تاريخ", "الترتيب لا يغيّر المصفوفة الأصلية");

    const sameDay = [
        { id: 1, title: "منخفضة", done: false, priority: "low", date: dayOffset(3) },
        { id: 2, title: "عاجلة", done: false, priority: "urgent", date: dayOffset(3) }
    ];

    const ordered = app.sortTasksForDisplay(sameDay).map((task) => task.title);

    check(ordered[0] === "عاجلة", "نفس اليوم: الأعلى أولوية أولاً");
}

/* =========================================================
   6) إضافة مهمة / تعديلها
========================================================= */

function testAddAndEdit(app) {
    console.log("\n6) إضافة مهمة / تعديلها");

    app.openAddTaskModal("personalTasks", "إضافة مهمة شخصية");

    check(
        app.getElement("taskForm").hasListener("submit"),
        "نموذج الإضافة يربط submit"
    );

    app.getElement("taskTitle").value = "دفع فاتورة الكهرباء";
    app.getElement("taskCategory").value = "home";
    app.getElement("taskPriority").value = "urgent";
    app.getElement("taskStatus").value = "inProgress";
    app.getElement("taskDate").value = dayOffset(2);
    app.getElement("taskTime").value = "18:30";
    app.getElement("taskNote").value = "قبل الانقطاع";

    app.getElement("taskForm").dispatch("submit");

    const month = app.currentMonthData();

    check(month.tasks.length === 1, "تمت إضافة المهمة");

    const added = month.tasks[0];

    check(added.title === "دفع فاتورة الكهرباء", "الاسم محفوظ");
    check(added.category === "home", "التصنيف محفوظ");
    check(added.priority === "urgent", "الأولوية محفوظة");
    check(added.status === "inProgress", "الحالة محفوظة");
    check(added.time === "18:30", "الوقت محفوظ");
    check(added.date === dayOffset(2), "التاريخ محفوظ");
    check(added.note === "قبل الانقطاع", "الملاحظة محفوظة");
    check(added.done === false, "غير مكتملة عند الإنشاء");
    check(added.listKey === "personalTasks", "listKey محفوظ");

    const savedAfterAdd = JSON.parse(app.store.get(STORAGE_KEY));

    check(
        savedAfterAdd.months[app.monthKey()].tasks.length === 1,
        "الحفظ المحلي: المهمة موجودة في localStorage"
    );

    /* ---- تعديل ---- */

    // النموذج يعرض كل بيانات المهمة الحالية (بدون فقدان أي معلومة)

    const editForm = app.taskFormHtml({
        title: "تعديل المهمة",
        task: added,
        listKey: "personalTasks"
    });

    check(
        editForm.indexOf('value="دفع فاتورة الكهرباء"') !== -1,
        "التعديل: الاسم الحالي يظهر"
    );
    check(
        editForm.indexOf('value="urgent" selected') !== -1,
        "التعديل: الأولوية الحالية تظهر"
    );
    check(
        editForm.indexOf('value="home" selected') !== -1,
        "التعديل: التصنيف الحالي يظهر"
    );
    check(
        editForm.indexOf('value="inProgress" selected') !== -1,
        "التعديل: الحالة الحالية تظهر"
    );
    check(
        editForm.indexOf('value="18:30"') !== -1,
        "التعديل: الوقت الحالي يظهر"
    );
    check(
        editForm.indexOf(`value="${dayOffset(2)}"`) !== -1,
        "التعديل: التاريخ الحالي يظهر"
    );
    check(
        editForm.indexOf("قبل الانقطاع") !== -1,
        "التعديل: الملاحظة الحالية تظهر"
    );

    app.openEditTaskModal(added.id);

    check(
        app.getElement("taskForm").hasListener("submit"),
        "نموذج التعديل يربط submit"
    );

    app.getElement("taskTitle").value = "دفع فاتورة الكهرباء";
    app.getElement("taskPriority").value = "low";
    app.getElement("taskCategory").value = "work";
    app.getElement("taskStatus").value = "completed";
    app.getElement("taskDate").value = dayOffset(2);
    app.getElement("taskTime").value = "18:30";
    app.getElement("taskNote").value = "قبل الانقطاع";

    app.getElement("taskForm").dispatch("submit");

    check(app.currentMonthData().tasks.length === 1, "التعديل لا يضيف مهمة جديدة");

    const edited = app.currentMonthData().tasks[0];

    check(edited.id === added.id, "نفس المهمة (id محفوظ)");
    check(edited.priority === "low", "التعديل: الأولوية تحدثت");
    check(edited.category === "work", "التعديل: التصنيف تحدث");
    check(edited.status === "completed" && edited.done === true, "التعديل: الحالة مكتملة و done متزامن");
    check(edited.time === "18:30", "التعديل: الوقت لم يُفقد");
    check(edited.note === "قبل الانقطاع", "التعديل: الملاحظة لم تُفقد");

    const savedAfterEdit = JSON.parse(app.store.get(STORAGE_KEY));

    check(
        savedAfterEdit.months[app.monthKey()].tasks[0].priority === "low",
        "الحفظ المحلي: التعديل محفوظ"
    );

    return edited;
}

/* =========================================================
   7) إكمال / إعادة فتح
========================================================= */

function testToggle(app, task) {
    console.log("\n7) إكمال / إعادة فتح");

    const month = app.currentMonthData();

    // المهمة مكتملة من الاختبار السابق -> نعيد فتحها
    app.toggleTask(task.id);

    check(task.status === "new" && task.done === false, "إعادة فتح مهمة مكتملة");
    check(month.tasks.length === 1, "إعادة الفتح لا تحذف المهمة");

    app.toggleTask(task.id);

    check(task.status === "completed" && task.done === true, "إكمال مهمة");
    check(month.tasks.length === 1, "الإكمال لا يحذف المهمة");

    // نرجعها غير مكتملة للاختبارات اللاحقة
    app.toggleTask(task.id);
}

/* =========================================================
   8) الحذف عبر تأكيد
========================================================= */

function testDelete(app) {
    console.log("\n8) حذف المهمة (بتأكيد)");

    const month = app.currentMonthData();

    app.openAddTaskModal("personalTasks", "إضافة");
    app.getElement("taskTitle").value = "مهمة للحذف";
    app.getElement("taskForm").dispatch("submit");

    check(month.tasks.length === 2, "مهمتان قبل الحذف");

    const target = month.tasks.find(
        (task) => task.title === "مهمة للحذف"
    );

    app.requestDeleteTask(target.id);

    check(month.tasks.length === 2, "لا حذف قبل التأكيد");

    app.getElement("confirmDeleteTaskButton").dispatch("click");

    check(month.tasks.length === 1, "الحذف بعد التأكيد");
    check(
        !month.tasks.some((task) => task.title === "مهمة للحذف"),
        "المهمة المحذوفة اختفت"
    );
}

/* =========================================================
   9) العرض + الحفظ + توافق المهام القديمة
========================================================= */

function testRendering(app) {
    console.log("\n9) العرض + الحفظ + توافق المهام القديمة");

    const month = app.currentMonthData();

    month.tasks = [
        {
            id: 100,
            listKey: "personalTasks",
            title: "مهمة قديمة",
            note: "ملاحظة قديمة",
            done: false,
            date: dayOffset(-1)
        }
    ];

    app.saveDatabase();
    app.renderTasks();

    const toolbar = app.getElement("personalTasksToolbar").innerHTML;

    check(toolbar.indexOf("كل المهام") !== -1, "بطاقات الإحصائيات تظهر");
    check(toolbar.indexOf("المتأخرة") !== -1, "بطاقة المتأخرة تظهر");
    check(toolbar.indexOf("قيد التنفيذ") !== -1, "بطاقة قيد التنفيذ تظهر");
    check(toolbar.indexOf("المكتملة") !== -1, "بطاقة المكتملة تظهر");
    check(toolbar.indexOf("data-task-stat") !== -1, "البطاقات قابلة للضغط");

    /* --- البحث والفلاتر محذوفة بالكامل --- */

    check(toolbar.indexOf("data-task-search") === -1, "لا يوجد بحث داخل الشريط");
    check(toolbar.indexOf("data-task-filter") === -1, "لا توجد فلاتر داخل الشريط");
    check(toolbar.indexOf("task-search") === -1, "لا يوجد عنصر بحث في HTML");
    check(toolbar.indexOf("task-tools") === -1, "لا توجد حاوية أدوات بحث/فلترة");
    check(toolbar.indexOf("task-filters") === -1, "لا توجد حاوية فلاتر");
    check(toolbar.indexOf("🔍") === -1, "أيقونة البحث اختفت");
    check(toolbar.indexOf("ابحث") === -1, "نص البحث اختفى");

    const list = app.getElement("personalTasksList").innerHTML;

    check(list.indexOf("مهمة قديمة") !== -1, "المهمة القديمة تظهر بلا خطأ");
    check(list.indexOf("task-badge") !== -1, "الوسوم تظهر");
    check(list.indexOf("ملاحظة قديمة") !== -1, "الملاحظة المختصرة تظهر");
    check(list.indexOf("data-task-toggle") !== -1, "زر الإكمال موجود");
    check(list.indexOf("data-task-edit") !== -1, "زر التعديل موجود");
    check(list.indexOf("data-task-delete") !== -1, "زر الحذف موجود");

    check(
        app.taskStats(month.tasks).overdue === 1,
        "مهمة قديمة بدون حقول جديدة تُحسب متأخرة"
    );

    const saved = JSON.parse(app.store.get(STORAGE_KEY));

    check(
        Array.isArray(saved.months[app.monthKey()].tasks) &&
            saved.months[app.monthKey()].tasks.length === 1,
        "المهام محفوظة داخل month.tasks في localStorage"
    );

    app.toggleTaskStat("personalTasks:overdue");

    check(
        app.taskViewState("personalTasks").quick === "overdue",
        "الضغط على البطاقة يفعّل الفلتر"
    );

    app.toggleTaskStat("personalTasks:overdue");

    check(
        app.taskViewState("personalTasks").quick === "all",
        "الضغط مرة أخرى يلغي الفلتر"
    );

    const escaped = app.taskRowHtml({
        id: 9,
        title: "<b>x</b>",
        done: false
    });

    check(escaped.indexOf("<b>") === -1, "تنقية اسم المهمة (لا HTML)");

    const homeToolbar = app.getElement("homeTasksToolbar").innerHTML;

    check(
        homeToolbar.indexOf("data-task-search") !== -1,
        "قسم مهام البيت له بحث وإحصائيات أيضاً"
    );
}

/* =========================================================
   MAIN
========================================================= */

(function main() {
    console.log("DAFTARI - قسم المهام");

    try {
        const app = createApp();

        testLegacyDefaults(app);

        testDates(app);

        testStats(app);

        testFilters(app);

        testSorting(app);

        const task = testAddAndEdit(app);

        testToggle(app, task);

        testDelete(app);

        testRendering(app);

    } catch (error) {
        failed += 1;

        console.error("\nUnexpected test error:");
        console.error(error);
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    process.exit(failed > 0 ? 1 : 0);
})();