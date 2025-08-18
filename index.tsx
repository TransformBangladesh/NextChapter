

// Supabase Client
const { createClient } = (window as any).supabase;
const supabaseUrl = 'https://gldcodlptflzpvbiquxp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsZGNvZGxwdGZsenB2YmlxdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDE2NzMsImV4cCI6MjA3MTAxNzY3M30.CwpFG_y3z-hLl7D0yddfc8psRrn1RBZbzkJa1x-rOlU';
const supabase = createClient(supabaseUrl, supabaseKey);

// Gemini AI Client
declare const process: any; // Assume process.env is available
import { GoogleGenAI, Type } from "@google/genai";
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});


document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    const getInitialState = () => ({
        subjects: [],
        notes: [],
        reminders: [],
        sessions: [],
        nextExam: null,
        settings: {
            darkMode: true,
            accentTheme: 'blue'
        },
        pomodoro: {
            timerId: null,
            mode: 'focus', // 'focus', 'short', 'long'
            timeRemaining: 25 * 60,
            isRunning: false,
            settings: {
                focus: 25,
                short: 5,
                long: 15
            }
        },
        timer: {
            timerId: null,
            timeRemaining: 0,
            isRunning: false,
            initialDuration: 0,
        },
        stopwatch: {
            timerId: null,
            startTime: 0,
            elapsedTime: 0,
            isRunning: false,
            laps: [],
        },
        ui: {
            currentPage: 'dashboard',
            selectedNoteId: null,
            sidebarOpen: false,
            selectedDate: new Date().toISOString().slice(0, 10),
            currentRoomId: null,
            breakSuggestion: {
                loading: false,
                suggestions: null,
                error: null
            },
        },
        calendar: {
            view: 'month', // 'month', 'week', 'day'
            currentDate: new Date(),
        },
        deleteContext: {
            type: null,
            id: null
        },
        logSessionContext: {
            type: null, 
            durationMinutes: 0,
            subjectId: null
        },
        currentUser: null,
        profile: null,
        // Gamification state
        achievements: [], // array of achievement IDs
        streak: {
            current: 0,
            lastStudyDay: null, // ISO date string 'YYYY-MM-DD'
        },
        room: { // For independent room timer
            timerId: null,
            mode: 'focus',
            timeRemaining: 25 * 60,
            isRunning: false
        }
    });

    let state = getInitialState();

    // --- DOM SELECTORS ---
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    // --- SUPABASE REAL-TIME SERVICE ---
    interface RoomParticipant {
        user: string;
        status: string;
        joinedAt: number;
    }
    let roomChannel = null;
    let roomParticipants: {[key: string]: RoomParticipant} = {};
    
    const joinRoom = async (roomId) => {
        if (!state.currentUser || !state.profile?.username) return;
        
        const channel = supabase.channel(roomId, {
            config: {
                presence: {
                    key: state.profile.username,
                },
            },
        });

        channel.on('presence', { event: 'sync' }, () => {
            const presenceState = channel.presenceState();
            roomParticipants = {};
            for (const id in presenceState) {
                const pres = presenceState[id][0] as any;
                roomParticipants[id] = { user: pres.user, status: pres.status, joinedAt: pres.joinedAt };
            }
            renderParticipants(roomParticipants);
        });

        channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
            renderSingleChatMessage(payload);
        });

        channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await channel.track({ 
                    user: state.profile.username, 
                    status: 'Idle',
                    joinedAt: Date.now()
                });
                
                requestNotificationPermission();
                state.ui.currentRoomId = roomId;
                
                state.room = getInitialState().room;
                switchRoomTimerMode('focus'); 
                
                $('#study-room-join').style.display = 'none';
                $('#study-room-view').classList.add('active');
                $('#chat-messages').innerHTML = '';
            } else {
                 console.error("Failed to subscribe to channel");
                 alert("Could not connect to the study room. Please try again.");
            }
        });

        roomChannel = channel;
    };

    const updatePresence = (status) => {
        if (!roomChannel) return;
        roomChannel.track({ 
            user: state.profile.username,
            status: status,
            joinedAt: roomParticipants[state.profile.username]?.joinedAt || Date.now()
        });
    };

    const sendChatMessage = (text) => {
        if (!roomChannel) return;
        const payload = {
            user: state.profile.username,
            text: text,
            timestamp: Date.now()
        };
        roomChannel.send({
            type: 'broadcast',
            event: 'chat',
            payload: payload,
        });
    };

    const leaveRoom = async () => {
        if (!roomChannel) return;

        pauseRoomTimer(false);
        await supabase.removeChannel(roomChannel);
        roomChannel = null;

        state.ui.currentRoomId = null;
        state.room = getInitialState().room;
        roomParticipants = {};
        
        $('#study-room-join').style.display = 'flex';
        $('#study-room-view').classList.remove('active');
        document.title = "NextChapter";
    };

    // --- SUPABASE DATA MANAGEMENT ---
    const loadAllDataForUser = async () => {
        if (!state.currentUser) return;

        const [profileRes, subjectsRes, notesRes, remindersRes, sessionsRes] = await Promise.all([
            supabase.from('profiles').select('*').eq('id', state.currentUser.id).single(),
            supabase.from('subjects').select('*').order('created_at'),
            supabase.from('notes').select('*').order('created_at', { ascending: false }),
            supabase.from('reminders').select('*').order('date'),
            supabase.from('sessions').select('*').order('date', { ascending: false })
        ]);

        if (profileRes.error || !profileRes.data) {
            console.error("Error loading profile", profileRes.error);
            handleSignOut(); // Log out if profile fails to load
            return;
        }

        // Reset state before loading new data
        const currentUser = state.currentUser;
        state = getInitialState();
        state.currentUser = currentUser;
        
        // Load profile data into state
        state.profile = profileRes.data;
        state.settings = { ...state.settings, ...(profileRes.data.settings || {}) };
        state.nextExam = profileRes.data.next_exam;
        state.achievements = profileRes.data.achievements || [];
        state.streak = { ...state.streak, ...(profileRes.data.streak || {}) };
        
        // Load other data
        state.subjects = subjectsRes.data || [];
        state.notes = notesRes.data || [];
        state.reminders = remindersRes.data || [];
        state.sessions = sessionsRes.data || [];
        
        // Post-load setup
        if (!state.subjects || state.subjects.length === 0) {
            await setupDefaultSubjects();
        }

        $('#current-user-name').textContent = state.profile.username;
        renderAll();
    };
    
    const setupDefaultSubjects = async () => {
        const defaultSubjects = [
            "Bangla 1st", "Bangla 2nd", "English 1st", "English 2nd", "ICT",
            "Physics 1st", "Physics 2nd", "Biology 1st", "Biology 2nd",
            "Chemistry 1st", "Chemistry 2nd", "Higher Math"
        ];
        const defaultColors = [
            '#E53E3E', '#DD6B20', '#D69E2E', '#38A169', '#319795', '#3182CE',
            '#5A67D8', '#805AD5', '#D53F8C', '#718096', '#4A5568', '#2D3748'
        ];
        const subjectsToInsert = defaultSubjects.map((name, index) => ({
            user_id: state.currentUser.id,
            name,
            goal: 0,
            color: defaultColors[index % defaultColors.length]
        }));
        
        const { data, error } = await supabase.from('subjects').insert(subjectsToInsert).select();
        if (data) {
            state.subjects = data;
        } else {
            console.error("Failed to create default subjects", error);
        }
    };

    // --- AUTHENTICATION ---
    const showLoginScreen = () => {
        $('#login-overlay').style.opacity = '1';
        $('#login-overlay').style.visibility = 'visible';
        $('#app').style.visibility = 'hidden';
    };

    const hideLoginScreen = () => {
        $('#login-overlay').style.opacity = '0';
        $('#login-overlay').style.visibility = 'hidden';
        $('#app').style.visibility = 'visible';
    };

    const handleSignOut = async () => {
        if(state.ui.currentRoomId) await leaveRoom();
        await supabase.auth.signOut();
        state = getInitialState();
        showLoginScreen();
    };

    // --- UI RENDERING ---
    const renderAll = () => {
        applySettings();
        renderNavigation();
        renderSubjects();
        renderNotes();
        renderDashboardReminders();
        renderCalendar();
        renderSessions();
        renderNextExam();
        renderDashboardProgressWidget();
        renderBreakSuggestionWidget();
        populateSubjectDropdowns();
        renderPomodoroSettings();
    };
    
    const toggleSidebar = () => {
        state.ui.sidebarOpen = !state.ui.sidebarOpen;
        $('.sidebar').classList.toggle('open', state.ui.sidebarOpen);
        $('.sidebar-overlay').classList.toggle('active', state.ui.sidebarOpen);
    }
    
    const MAIN_NAV_PAGES = ['dashboard', 'rooms', 'calendar', 'more'];
    const SECONDARY_NAV_PAGES = ['sessions', 'analytics', 'timer', 'stopwatch', 'notes', 'subjects', 'settings'];

    const navigateToPage = async (pageId) => {
        if (!pageId) return;
        if(state.ui.currentRoomId && pageId !== 'rooms') {
            if(!confirm("You are in an active study room. Are you sure you want to leave the room and navigate away?")) {
                return;
            }
            await leaveRoom();
        }

        state.ui.currentPage = pageId;
        
        $$('.page').forEach(p => p.classList.remove('active'));
        const page = $('#' + pageId);
        if (page) {
            page.classList.add('active');
            page.closest('.page-container').scrollTop = 0;
        }

        // Update active states for sidebar, bottom nav, and mobile nav list
        const activePage = SECONDARY_NAV_PAGES.includes(pageId) ? 'more' : pageId;
        $$('.nav-link, .bottom-nav-link').forEach(l => {
             l.classList.toggle('active', l.dataset.page === pageId);
        });
        $$('.bottom-nav-link').forEach(l => {
             l.classList.toggle('active', l.dataset.page === activePage);
        });
        $$('#more-nav-list .nav-link').forEach(l => {
             l.classList.toggle('active', l.dataset.page === pageId);
        });


        switch(pageId) {
            case 'calendar': renderCalendar(); break;
            case 'analytics': renderAnalyticsPage(); break;
        }
        
        renderHeader(pageId);
        
        if (state.ui.sidebarOpen) {
            toggleSidebar();
        }
    };

    const renderHeader = (pageId) => {
        const headerContent = $('#main-header-content');
        if (!headerContent) return;

        const pageConfig = NAV_ITEMS.find(item => item.id === pageId);
        const title = pageConfig ? pageConfig.label : "Dashboard";
        
        let buttonsHTML = '';
        if (pageId === 'subjects') {
            buttonsHTML = `<button id="add-subject-btn" class="btn btn-primary">
                <svg class="nav-icon" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"></path></svg>
            </button>`;
        } else if (pageId === 'notes') {
             buttonsHTML = `<button id="new-note-btn" class="btn btn-primary">
                <svg class="nav-icon" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"></path></svg>
            </button>`;
        }
        
        headerContent.innerHTML = `<h2 class="page-header">${title}</h2>${buttonsHTML}`;
    };


    // --- MODALS ---
    const showModal = (modalId) => $(`#${modalId}`).classList.add('show');
    const hideModal = (modalId) => $(`#${modalId}`).classList.remove('show');
    const hideAllModals = () => $$('.modal-container').forEach(m => m.classList.remove('show'));

    // --- SETTINGS ---
    const applySettings = () => {
        document.body.classList.toggle('light-mode', !state.settings.darkMode);
        $('#dark-mode-toggle').checked = state.settings.darkMode;

        document.body.dataset.accentTheme = state.settings.accentTheme;
        $$('#color-palette .color-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.color === state.settings.accentTheme);
        });
    };

    const renderPomodoroSettings = () => {
        $('#setting-focus-time').value = state.pomodoro.settings.focus;
        $('#setting-short-break-time').value = state.pomodoro.settings.short;
        $('#setting-long-break-time').value = state.pomodoro.settings.long;
        updatePomodoroModeButtons();
    }
    
    const createColorSwatches = () => {
        const colors = { blue: '#4A80F0', red: '#E53E3E', orange: '#DD6B20', purple: '#805AD5', green: '#38A169', moss: '#C1C454' };
        const paletteContainer = $('#color-palette');
        const subjectColorPicker = $('#subject-color-picker');
        paletteContainer.innerHTML = '';
        subjectColorPicker.innerHTML = '';

        Object.entries(colors).forEach(([name, hex]) => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.dataset.color = name;
            swatch.style.backgroundColor = hex;
            paletteContainer.appendChild(swatch.cloneNode(true));
            subjectColorPicker.appendChild(swatch.cloneNode(true));
        });
    };

    // --- SUBJECTS ---
    const renderSubjects = () => {
        const grid = $('#subjects-grid');
        if (!grid) return;
        
        if (state.subjects.length === 0) {
            grid.innerHTML = `<div class="placeholder-container">
                <svg class="icon" viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"></path></svg>
                <h3>No Subjects Yet</h3>
                <p>Create a subject to start organizing your study materials.</p>
            </div>`;
            return;
        }
        
        grid.innerHTML = state.subjects.map(s => {
            let progressHTML = `<p class="subject-goal" style="color: var(--text-secondary);">No goal set. Click edit to add one.</p>`;
            if (s.goal > 0) {
                const monthlyMinutes = getStudyMinutesForMonth(s.id);
                const goalMinutes = s.goal * 60;
                const progressPercent = goalMinutes > 0 ? Math.min((monthlyMinutes / goalMinutes) * 100, 100) : 0;
                
                const now = new Date();
                const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                const daysLeft = totalDaysInMonth - now.getDate();

                progressHTML = `
                    <div class="subject-progress-container">
                        <div class="progress-bar-info">
                            <span>${formatMinutes(monthlyMinutes)} / ${s.goal}h</span>
                            <span>${daysLeft} day${daysLeft !== 1 ? 's' : ''} left</span>
                        </div>
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fg" style="width: ${progressPercent}%; background-color: ${s.color};"></div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="subject-card">
                    <div class="subject-card-header">
                        <h4 class="subject-title">
                            <span class="subject-color-dot" style="background-color: ${s.color};"></span>
                            ${s.name}
                        </h4>
                        <div class="subject-card-actions">
                            <button class="edit-subject-btn" data-id="${s.id}" aria-label="Edit subject">
                                <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>
                            </button>
                            <button class="delete-subject-btn" data-id="${s.id}" aria-label="Delete subject">
                                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
                            </button>
                        </div>
                    </div>
                    ${progressHTML}
                </div>
            `;
        }).join('');
    };
    
    const handleSubjectForm = async (e) => {
        e.preventDefault();
        const id = $('#subject-id').value;
        const name = $('#subject-name').value;
        const goal = parseFloat($('#subject-goal').value) || 0;
        const color = $('#subject-color-picker .color-swatch.active')?.style.backgroundColor || '#A0A3B1';

        const subjectData = { name, goal, color, user_id: state.currentUser.id };

        if (id) {
            const { data, error } = await supabase.from('subjects').update(subjectData).eq('id', id).select().single();
            if (error) console.error("Error updating subject", error);
            else if (data) {
                const index = state.subjects.findIndex(s => s.id == id);
                if (index > -1) state.subjects[index] = data;
            }
        } else {
            const { data, error } = await supabase.from('subjects').insert(subjectData).select().single();
             if (error) console.error("Error creating subject", error);
             else if(data) state.subjects.push(data);
        }
        
        renderSubjects();
        populateSubjectDropdowns();
        hideModal('subject-modal');
    };
    
    const populateSubjectDropdowns = () => {
        const selects = $$('#pomodoro-subject, #note-subject, #reminder-subject, #exam-subject, #timer-subject, #stopwatch-subject, #room-subject');
        selects.forEach(select => {
            const currentValue = select.value;
            let options;
            if (['pomodoro-subject', 'timer-subject', 'stopwatch-subject', 'room-subject'].includes(select.id)) {
                options = '<option value="">None</option>';
            } else {
                options = '<option value="">Select a subject</option>';
            }
            state.subjects.forEach(s => {
                options += `<option value="${s.id}">${s.name}</option>`;
            });
            select.innerHTML = options;
            select.value = currentValue;
        });
    };

    // --- NOTES ---
    const renderNotes = () => {
        const list = $('#notes-list');
        if (!list) return;

        const query = $('#notes-search-bar').value.toLowerCase();
        const filteredNotes = state.notes.filter(n => n.title.toLowerCase().includes(query));

        if (filteredNotes.length === 0) {
            list.innerHTML = '<p class="placeholder-text" style="padding: 12px;">No notes found.</p>';
        } else {
             list.innerHTML = filteredNotes.map(n => `
                <li class="note-item ${n.id === state.ui.selectedNoteId ? 'selected' : ''}" data-id="${n.id}">
                    <h4>${n.title}</h4>
                    <p>${getSubjectNameById(n.subject_id) || 'No Subject'}</p>
                </li>
            `).join('');
        }
        renderSelectedNote();
    };
    
    const renderSelectedNote = () => {
        const viewPanel = $('#note-view-panel');
        if (!viewPanel) return;
        
        const note = state.notes.find(n => n.id === state.ui.selectedNoteId);
        
        if (!note) {
            viewPanel.innerHTML = `<div class="placeholder-container">
                <svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path></svg>
                <h3>Select a note to view</h3>
                <p>Or create a new note to get started.</p>
            </div>`;
            return;
        }
        
        const subject = state.subjects.find(s => s.id === note.subject_id);
        viewPanel.innerHTML = `
            <button class="back-to-list-btn">
               <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"></path></svg>
               Back to list
            </button>
            <div class="note-view-header">
                <div>
                    <h3 class="note-view-title">${note.title}</h3>
                    ${subject ? `<span class="note-view-subject" style="color: ${subject.color}">${subject.name}</span>` : ''}
                </div>
                 <div class="note-actions">
                     <button class="btn edit-note-btn" data-id="${note.id}">Edit</button>
                     <button class="btn delete-note-btn" data-id="${note.id}">Delete</button>
                </div>
            </div>
            <div class="note-view-content">${note.content}</div>
        `;
    };

    const handleNoteForm = async (e) => {
        e.preventDefault();
        const id = $('#note-id').value;
        const title = $('#note-title').value;
        const subjectId = $('#note-subject').value || null;
        const content = $('#note-content-editor').innerHTML;

        const noteData = { title, subject_id: subjectId, content, user_id: state.currentUser.id };
        
        if (id) {
            const { data, error } = await supabase.from('notes').update(noteData).eq('id', id).select().single();
            if(error) console.error("Error updating note:", error);
            else if(data) {
                const index = state.notes.findIndex(n => n.id == id);
                if(index > -1) state.notes[index] = data;
            }
        } else {
            const { data, error } = await supabase.from('notes').insert(noteData).select().single();
            if(error) console.error("Error creating note:", error);
            else if(data) {
                state.notes.unshift(data);
                state.ui.selectedNoteId = data.id;
            }
        }
        
        renderNotes();
        hideModal('note-modal');
        
        if (window.innerWidth <= 992) {
            $('#notes-layout').classList.add('viewing-note');
        }
    };

    // --- REMINDERS & CALENDAR ---
    const renderDashboardReminders = () => {
        const dashboardList = $('#dashboard-reminder-list');
        if (!dashboardList) return;

        const today = new Date().toISOString().slice(0, 10);
        const todaysReminders = state.reminders.filter(p => p.date === today);

        if (todaysReminders.length === 0) {
            dashboardList.innerHTML = `<p class="placeholder-text">No reminders for today. Add one from the calendar!</p>`;
            return;
        }

        dashboardList.innerHTML = todaysReminders.map(r => `
            <div class="list-item reminder-item ${r.completed ? 'completed' : ''}" data-id="${r.id}">
                <div class="list-item-main">
                    <input type="checkbox" class="reminder-checkbox" ${r.completed ? 'checked' : ''} data-reminder-id="${r.id}">
                    <div>
                        <p class="list-item-title">${r.title}</p>
                        <p class="list-item-details">${getSubjectNameById(r.subject_id) || 'Uncategorized'}</p>
                    </div>
                </div>
                <div class="list-item-actions">
                   <button class="edit-reminder-btn" data-reminder-id="${r.id}" aria-label="Edit reminder">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>
                   </button>
                   <button class="delete-reminder-btn" data-reminder-id="${r.id}" aria-label="Delete reminder">
                       <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
                   </button>
                </div>
            </div>
        `).join('');
    };

    const renderCalendar = () => {
        if (state.ui.currentPage !== 'calendar') return;
        renderHeader('calendar');
        renderCalendarHeader();
        renderMonthView();
    };

    const renderCalendarHeader = () => {
        const date = state.calendar.currentDate;
        const titleText = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        $$('#calendar-title, #main-header-content #calendar-title').forEach(el => {
            if (el) el.textContent = titleText;
        });
    };

    const renderMonthView = () => {
        const container = $('#calendar-container');
        const date = state.calendar.currentDate;
        const year = date.getFullYear();
        const month = date.getMonth();
        const today = new Date();
        today.setHours(0,0,0,0);

        const firstDayOfMonth = new Date(year, month, 1);
        
        let currentDay = new Date(firstDayOfMonth);
        currentDay.setDate(currentDay.getDate() - currentDay.getDay());

        let calendarHTML = `
            <div class="calendar-grid-header">
                <div>SUN</div><div>MON</div><div>TUE</div><div>WED</div><div>THU</div><div>FRI</div><div>SAT</div>
            </div>
            <div class="calendar-grid">`;
        
        const totalDaysToShow = 42;

        for (let i = 0; i < totalDaysToShow; i++) {
            const isOtherMonth = currentDay.getMonth() !== month;
            const isToday = currentDay.getTime() === today.getTime();
            const dateString = currentDay.toISOString().slice(0, 10);
            const remindersForDay = state.reminders.filter(p => p.date === dateString);

            calendarHTML += `
                <div class="calendar-day ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${dateString}">
                    <div class="day-number">${currentDay.getDate()}</div>
                    <div class="day-reminders">
                        ${remindersForDay.map(r => {
                            const subject = getSubjectById(r.subject_id);
                            const isMobile = window.innerWidth <= 768;
                            return `<div class="reminder-item-calendar ${isMobile ? 'dot' : ''} ${r.completed ? 'completed' : ''}" data-reminder-id="${r.id}" style="background-color:${subject?.color || 'var(--accent-color)'}; color: ${isMobile ? 'transparent' : 'var(--accent-text-color)'}">${r.title}</div>`
                        }).join('')}
                    </div>
                </div>`;
            currentDay.setDate(currentDay.getDate() + 1);
        }
        calendarHTML += `</div>`;
        container.innerHTML = calendarHTML;
    };
    
    const handleReminderForm = async (e) => {
        e.preventDefault();
        const id = $('#reminder-id').value;
        const title = $('#reminder-title').value;
        const subjectId = $('#reminder-subject').value || null;
        const date = $('#reminder-date').value;

        const reminderData = { title, subject_id: subjectId, date, user_id: state.currentUser.id };
        
        if (id) {
            const { data, error } = await supabase.from('reminders').update({ title, subject_id: subjectId, date }).eq('id', id).select().single();
            if(error) console.error("Error updating reminder:", error);
            else if (data) {
                const index = state.reminders.findIndex(r => r.id == id);
                if (index > -1) state.reminders[index] = data;
            }
        } else {
            const { data, error } = await supabase.from('reminders').insert({ ...reminderData, completed: false }).select().single();
            if(error) console.error("Error creating reminder:", error);
            else if(data) state.reminders.push(data);
        }
        
        state.reminders.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        renderDashboardReminders();
        renderCalendar();
        hideModal('reminder-modal');
    };

    // --- POMODORO ---
    const updateTimerDisplay = () => {
        const minutes = String(Math.floor(state.pomodoro.timeRemaining / 60)).padStart(2, '0');
        const seconds = String(state.pomodoro.timeRemaining % 60).padStart(2, '0');
        $('#timer-display').textContent = `${minutes}:${seconds}`;
        if(state.ui.currentPage === 'dashboard' && !state.ui.currentRoomId){
            document.title = `${minutes}:${seconds} - NextChapter`;
        }
    };

    const updatePomodoroModeButtons = () => {
        $('#pomodoro-mode-focus').textContent = `Focus (${state.pomodoro.settings.focus}m)`;
        $('#pomodoro-mode-short').textContent = `Short Break (${state.pomodoro.settings.short}m)`;
        $('#pomodoro-mode-long').textContent = `Long Break (${state.pomodoro.settings.long}m)`;
    }

    const switchPomodoroMode = (mode) => {
        if (state.pomodoro.isRunning && !confirm("A timer is running. Are you sure you want to switch and reset?")) {
            return;
        }
        pauseTimer();
        state.pomodoro.mode = mode;
        
        $$('.pomodoro-mode').forEach(b => b.classList.remove('active'));
        $(`.pomodoro-mode[data-mode="${mode}"]`).classList.add('active');
        
        state.pomodoro.timeRemaining = state.pomodoro.settings[mode] * 60;
        updateTimerDisplay();
    };

    const startTimer = () => {
        if (state.pomodoro.isRunning) return;
        state.pomodoro.isRunning = true;
        $('#play-icon').style.display = 'none';
        $('#pause-icon').style.display = 'block';

        state.pomodoro.timerId = setInterval(() => {
            state.pomodoro.timeRemaining--;
            updateTimerDisplay();

            if (state.pomodoro.timeRemaining <= 0) {
                finishSession();
                playAlarm();
            }
        }, 1000);
    };
    
    const pauseTimer = () => {
        if (!state.pomodoro.isRunning) return;
        state.pomodoro.isRunning = false;
        clearInterval(state.pomodoro.timerId);
        state.pomodoro.timerId = null;
        $('#play-icon').style.display = 'block';
        $('#pause-icon').style.display = 'none';
    };

    const resetTimer = () => {
        pauseTimer();
        state.pomodoro.timeRemaining = state.pomodoro.settings[state.pomodoro.mode] * 60;
        updateTimerDisplay();
    }

    const finishSession = async (skipped = false) => {
        const durationSeconds = state.pomodoro.settings[state.pomodoro.mode] * 60 - (skipped ? state.pomodoro.timeRemaining : 0);

        if (state.pomodoro.mode === 'focus' && durationSeconds > 60) {
            const session = {
                user_id: state.currentUser.id,
                subject_id: $('#pomodoro-subject').value || null,
                duration: Math.round(durationSeconds / 60),
                date: new Date().toISOString()
            };
            const { data, error } = await supabase.from('sessions').insert(session).select().single();
            if (data) state.sessions.unshift(data);
            
            await updateGamificationState();

            renderSessions();
            renderSubjects();
            renderDashboardProgressWidget();
        }
        
        pauseTimer();
        const nextMode = state.pomodoro.mode === 'focus' ? 'short' : 'focus';

        const notificationTitle = state.pomodoro.mode === 'focus' ? 'Focus complete!' : 'Break is over!';
        const notificationBody = nextMode === 'focus' ? 'Time to get back to work!' : 'Time for a short break!';
        showNotification(notificationTitle, { body: notificationBody });

        switchPomodoroMode(nextMode);
    };

    // --- SESSIONS ---
    const renderSessions = () => {
        const list = $('#session-list');
        if(!list) return;

        if (state.sessions.length === 0) {
             list.innerHTML = `<div class="placeholder-container">
                <svg class="icon" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"></path><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path></svg>
                <h3>No Sessions Logged</h3>
                <p>Use the Pomodoro timer to start a study session.</p>
            </div>`;
            return;
        }
        
        list.innerHTML = state.sessions.map(s => `
            <div class="list-item session-item">
                <div class="list-item-main">
                    <div>
                        <p class="list-item-title">${getSubjectNameById(s.subject_id) || 'General Study'}</p>
                        <p class="list-item-details">${new Date(s.date).toLocaleString()}</p>
                    </div>
                </div>
                <span class="session-duration">${s.duration} min</span>
            </div>
        `).join('');
    };

    // --- EXAM COUNTDOWN ---
    const renderNextExam = () => {
        const widget = $('#exam-widget');
        if(!widget) return;
        
        if (!state.nextExam || !state.nextExam.date) {
            widget.classList.add('no-exam');
            widget.innerHTML = `
                <div class="exam-widget-header">
                    <svg class="nav-icon" viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"></path></svg>
                    <span>Next Exam</span>
                </div>
                <p>Click to set your next exam</p>`;
        } else {
            widget.classList.remove('no-exam');
            const examDate = new Date(state.nextExam.date);
            const today = new Date();
            today.setHours(0,0,0,0);
            const diffTime = examDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const subject = getSubjectById(state.nextExam.subjectId);
            
            widget.innerHTML = `
                <p class="days">${diffDays >= 0 ? diffDays : 0}</p>
                <p class="days-label">days left</p>
                <h4 class="exam-title">${state.nextExam.title}</h4>
                ${subject ? `<span id="exam-subject-tag" style="color: ${subject.color};">${subject.name}</span>` : ''}
            `;
        }
    };
    
    const handleExamForm = async (e) => {
        e.preventDefault();
        const nextExam = {
            title: $('#exam-title').value,
            subjectId: $('#exam-subject').value,
            date: $('#exam-date').value
        };
        
        const { data, error } = await supabase.from('profiles').update({ next_exam: nextExam }).eq('id', state.currentUser.id);
        if(!error) {
            state.nextExam = nextExam;
            renderNextExam();
        }
        hideModal('exam-modal');
    };

    // --- GEMINI AI ---
    const renderBreakSuggestionWidget = () => {
        const widget = $('#gemini-break-widget');
        if (!widget) return;

        const { loading, suggestions, error } = state.ui.breakSuggestion;

        let contentHTML = '';
        if (loading) {
            contentHTML = `<div class="gemini-suggestion-content"><div class="gemini-loading-spinner"></div></div>`;
        } else if (error) {
            contentHTML = `<p>Sorry, I couldn't get a suggestion. Please try again.</p>`;
        } else if (suggestions) {
            contentHTML = `
                <div class="gemini-suggestion-result">
                    <ul>
                        ${suggestions.map(s => `<li><strong>${s.title}</strong><p>${s.description}</p></li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
            contentHTML = `<p>Feeling stuck? Let AI suggest a refreshing break to clear your mind.</p>`;
        }

        widget.innerHTML = `
            <div class="gemini-widget-header">
                <h3>AI Break Suggester</h3>
            </div>
            ${contentHTML}
            <button id="gemini-suggest-btn" class="btn" ${loading ? 'disabled' : ''}>
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.75L13.8375 8.1625L19.25 10L13.8375 11.8375L12 17.25L10.1625 11.8375L4.75 10L10.1625 8.1625L12 2.75ZM18.25 13.5L19.5625 16.3125L22.25 17.5L19.5625 18.6875L18.25 21.5L16.9375 18.6875L14.25 17.5L16.9375 16.3125L18.25 13.5Z"></path></svg>
                <span>${suggestions ? 'Suggest Another' : '✨ Suggest a Break'}</span>
            </button>
            <p class="gemini-attribution">Powered by Gemini</p>
        `;
    };

    const getStudyBreakSuggestion = async () => {
        state.ui.breakSuggestion = { ...state.ui.breakSuggestion, loading: true, error: null };
        renderBreakSuggestionWidget();

        try {
            const prompt = "I've been studying hard. Suggest three short, refreshing 5-10 minute study break activities. The suggestions should be things I can do away from my screen to recharge. Focus on mindfulness, light physical activity, or simple creative tasks.";
            
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            breaks: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        title: { type: Type.STRING },
                                        description: { type: Type.STRING }
                                    },
                                    required: ["title", "description"]
                                }
                            }
                        },
                        required: ["breaks"]
                    }
                }
            });

            const jsonResponse = JSON.parse(response.text);
            state.ui.breakSuggestion.suggestions = jsonResponse.breaks;

        } catch (err) {
            console.error("Gemini API error:", err);
            state.ui.breakSuggestion.error = "Failed to get suggestions.";
            state.ui.breakSuggestion.suggestions = null;
        } finally {
            state.ui.breakSuggestion.loading = false;
            renderBreakSuggestionWidget();
        }
    };


    // --- ANALYTICS & GAMIFICATION ---
    const renderAnalyticsPage = () => {
        renderGamificationStats();
        renderHeatmap();
        renderSubjectPieChart();
        renderAchievements();
    };
    
    const renderDashboardProgressWidget = () => {
        const widget = $('#progress-widget');
        if (!widget) return;
        const totalMinutes = getTotalStudyMinutes(state);
        const level = Math.floor(totalMinutes / 60 / 10) + 1;

        widget.innerHTML = `
            <h3>Progress</h3>
            <div class="dashboard-progress-grid">
                <div class="dashboard-progress-item">
                    <div class="value">${state.streak.current}</div>
                    <div class="label">Day Streak</div>
                </div>
                <div class="dashboard-progress-item">
                    <div class="value">${level}</div>
                    <div class="label">Focus Level</div>
                </div>
            </div>
        `;
    };
    
    const renderGamificationStats = () => {
        const container = $('#gamification-stats');
        if (!container) return;
        const totalMinutes = getTotalStudyMinutes(state);
        const level = Math.floor(totalMinutes / 60 / 10) + 1;
        
        container.innerHTML = `
            <div class="stat-card">
                <div class="value">${level}</div>
                <div class="label">Focus Level</div>
            </div>
             <div class="stat-card">
                <div class="value">${state.streak.current}</div>
                <div class="label">Study Streak</div>
            </div>
             <div class="stat-card">
                <div class="value">${formatMinutes(totalMinutes)}</div>
                <div class="label">Total Study Time</div>
            </div>
             <div class="stat-card">
                <div class="value">${state.sessions.length}</div>
                <div class="label">Sessions Completed</div>
            </div>
        `;
    };

    const renderHeatmap = () => {
        const container = $('#heatmap-container');
        if (!container) return;

        const studyByDay = state.sessions.reduce((acc, session) => {
            const day = new Date(session.date).toISOString().slice(0, 10);
            acc[day] = (acc[day] || 0) + session.duration;
            return acc;
        }, {});
        
        let heatmapHTML = '';
        const today = new Date();
        const daysToShow = 365;
        let currentDate = new Date(today);
        currentDate.setDate(currentDate.getDate() - daysToShow + 1);
        
        currentDate.setDate(currentDate.getDate() - currentDate.getDay());

        for (let i = 0; i < daysToShow + today.getDay(); i++) {
            const dateString = currentDate.toISOString().slice(0, 10);
            const minutes = studyByDay[dateString] || 0;
            let level = 0;
            if (minutes > 180) level = 4;
            else if (minutes > 90) level = 3;
            else if (minutes > 30) level = 2;
            else if (minutes > 0) level = 1;

            heatmapHTML += `
                <div class="heatmap-day" data-level="${level}">
                    <div class="heatmap-tooltip">${dateString}: ${formatMinutes(minutes)}</div>
                </div>
            `;
            currentDate.setDate(currentDate.getDate() + 1);
        }
        container.innerHTML = heatmapHTML;
    };
    
    const renderSubjectPieChart = () => {
        const container = $('#subject-chart-container');
        if (!container) return;

        const totalMinutes = getTotalStudyMinutes(state);
        if (totalMinutes === 0) {
            container.innerHTML = '<p class="placeholder-text">No session data to display chart.</p>';
            return;
        }

        const minutesBySubject = state.sessions.reduce((acc, session) => {
            if (session.subject_id) {
                acc[session.subject_id] = (acc[session.subject_id] || 0) + session.duration;
            }
            return acc;
        }, {});

        const sortedSubjects = Object.entries(minutesBySubject).sort(([, a], [, b]) => b - a);

        let pieChartSVG = '<svg id="subject-pie-chart" viewBox="0 0 100 100">';
        let legendHTML = '<div class="pie-chart-legend">';
        let cumulativePercent = 0;

        sortedSubjects.forEach(([subjectId, minutes]) => {
            const subject = getSubjectById(subjectId);
            if (!subject) return;

            const percent = (minutes / totalMinutes) * 100;
            const strokeDasharray = `${percent} ${100 - percent}`;
            const strokeDashoffset = -cumulativePercent;

            pieChartSVG += `<circle r="15.915" cx="50" cy="50" stroke="${subject.color}" stroke-dasharray="${strokeDasharray}" stroke-dashoffset="${strokeDashoffset}"></circle>`;
            
            legendHTML += `
                <div class="legend-item">
                    <div class="legend-color-box" style="background-color: ${subject.color};"></div>
                    <span class="legend-name">${subject.name}</span>
                    <span class="legend-percent">${percent.toFixed(1)}%</span>
                </div>
            `;

            cumulativePercent += percent;
        });
        
        pieChartSVG += '</svg>';
        legendHTML += '</div>';
        container.innerHTML = pieChartSVG + legendHTML;
    };

    const renderAchievements = () => {
        const grid = $('#achievements-grid');
        if (!grid) return;

        grid.innerHTML = Object.entries(ACHIEVEMENTS_LIST).map(([id, ach]) => {
            const unlocked = state.achievements.includes(id);
            return `
                <div class="achievement-card ${unlocked ? 'unlocked' : ''}">
                    <svg class="icon" viewBox="0 0 24 24">${ach.icon}</svg>
                    <h4>${ach.name}</h4>
                    <p>${ach.description}</p>
                </div>
            `;
        }).join('');
    };

    const updateGamificationState = async () => {
        const today = new Date();
        const todayStr = today.toISOString().slice(0,10);
        const lastDayStr = state.streak.lastStudyDay;
        let streakUpdated = false;

        if (!lastDayStr || lastDayStr === todayStr) {
            if (!lastDayStr) {
               state.streak.current = 1;
               streakUpdated = true;
            }
        } else {
            const lastDay = new Date(lastDayStr);
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            if (lastDay.toDateString() === yesterday.toDateString()) {
                state.streak.current += 1;
            } else {
                state.streak.current = 1;
            }
            streakUpdated = true;
        }
        state.streak.lastStudyDay = todayStr;

        if (streakUpdated) {
            await supabase.from('profiles').update({ streak: state.streak }).eq('id', state.currentUser.id);
        }

        let achievementsUpdated = false;
        for (const [id, ach] of Object.entries(ACHIEVEMENTS_LIST)) {
            if (!state.achievements.includes(id) && ach.condition(state)) {
                state.achievements.push(id);
                achievementsUpdated = true;
            }
        }
        if(achievementsUpdated) {
            await supabase.from('profiles').update({ achievements: state.achievements }).eq('id', state.currentUser.id);
        }
    };
    

    // --- CUSTOM TIMER ---
    const updateCustomTimerDisplay = () => {
        const time = state.timer.timeRemaining;
        const hours = String(Math.floor(time / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((time % 3600) / 60)).padStart(2, '0');
        const seconds = String(time % 60).padStart(2, '0');
        $('#custom-timer-display').textContent = `${hours}:${minutes}:${seconds}`;
    };
    
    const startCustomTimer = () => {
        if(state.timer.isRunning) return;
        
        let hours = Number(($('#timer-hours') as HTMLInputElement)?.value) || 0;
        let minutes = Number(($('#timer-minutes') as HTMLInputElement)?.value) || 0;
        let seconds = Number(($('#timer-seconds') as HTMLInputElement)?.value) || 0;
        let totalSeconds = hours * 3600 + minutes * 60 + seconds;

        if(totalSeconds <= 0) return;
        
        if(state.timer.timeRemaining <= 0 || state.timer.initialDuration !== totalSeconds) {
            state.timer.timeRemaining = totalSeconds;
            state.timer.initialDuration = totalSeconds;
        }

        state.timer.isRunning = true;
        state.timer.timerId = setInterval(() => {
            state.timer.timeRemaining--;
            updateCustomTimerDisplay();
            if(state.timer.timeRemaining <= 0) {
                const subjectId = ($('#timer-subject') as HTMLSelectElement)?.value;
                const durationMinutes = Math.round(state.timer.initialDuration / 60);
                
                pauseCustomTimer();
                playAlarm();
                showNotification('Timer Finished!', { body: `Your custom timer of ${formatMinutes(durationMinutes)} has ended.` });

                if (subjectId && durationMinutes > 0) {
                    state.logSessionContext = {
                        type: 'timer',
                        durationMinutes: durationMinutes,
                        subjectId: subjectId
                    };
                    $('#log-session-modal-text').textContent = `Add a ${durationMinutes} minute session to "${getSubjectNameById(subjectId)}"?`;
                    showModal('log-session-modal');
                }
            }
        }, 1000);
    };

    const pauseCustomTimer = () => {
        state.timer.isRunning = false;
        clearInterval(state.timer.timerId);
        state.timer.timerId = null;
    };

    const resetCustomTimer = () => {
        pauseCustomTimer();
        state.timer.timeRemaining = state.timer.initialDuration;
        updateCustomTimerDisplay();
    };

    // --- STOPWATCH ---
    const updateStopwatchDisplay = () => {
        const time = state.stopwatch.elapsedTime;
        const hours = String(Math.floor(time / 3600000)).padStart(2, '0');
        const minutes = String(Math.floor((time % 3600000) / 60000)).padStart(2, '0');
        const seconds = String(Math.floor((time % 60000) / 1000)).padStart(2, '0');
        const ms = String(Math.floor((time % 1000) / 10)).padStart(2, '0');
        $('#stopwatch-display').textContent = `${hours}:${minutes}:${seconds}.${ms}`;
    };

    const startStopwatch = () => {
        if(state.stopwatch.isRunning) return;
        state.stopwatch.isRunning = true;
        state.stopwatch.startTime = Date.now() - state.stopwatch.elapsedTime;
        state.stopwatch.timerId = setInterval(updateStopwatch, 10);
        $('#stopwatch-lap-btn').disabled = false;
    };

    const updateStopwatch = () => {
        state.stopwatch.elapsedTime = Date.now() - state.stopwatch.startTime;
        updateStopwatchDisplay();
    }

    const stopStopwatch = () => {
        if (!state.stopwatch.isRunning) return;
        state.stopwatch.isRunning = false;
        clearInterval(state.stopwatch.timerId);
        state.stopwatch.timerId = null;
        $('#stopwatch-lap-btn').disabled = true;

        const subjectId = $('#stopwatch-subject').value;
        const durationMinutes = Math.round(state.stopwatch.elapsedTime / (1000 * 60));
        
        if (subjectId && durationMinutes > 0) {
            state.logSessionContext = {
                type: 'stopwatch',
                durationMinutes,
                subjectId
            };
            $('#log-session-modal-text').textContent = `Add a ${durationMinutes} minute session to "${getSubjectNameById(subjectId)}"?`;
            showModal('log-session-modal');
        }
    };

    const resetStopwatch = () => {
        state.stopwatch.isRunning = false;
        clearInterval(state.stopwatch.timerId);
        state.stopwatch.timerId = null;
        
        state.stopwatch.elapsedTime = 0;
        state.stopwatch.laps = [];
        updateStopwatchDisplay();
        renderLaps();
        $('#stopwatch-lap-btn').disabled = true;
    };
    
    const addLap = () => {
        if(!state.stopwatch.isRunning) return;
        state.stopwatch.laps.push(state.stopwatch.elapsedTime);
        renderLaps();
    };

    const renderLaps = () => {
        const lapsContainer = $('#laps-container');
        const list = $('#laps-list');
        if(state.stopwatch.laps.length > 0) {
            lapsContainer.style.display = 'block';
            list.innerHTML = state.stopwatch.laps.map((lapTime, index) => {
                return `<li class="lap-item">
                            <span class="lap-number">Lap ${index + 1}</span>
                            <span class="lap-time">${formatStopwatchTime(lapTime)}</span>
                        </li>`
            }).reverse().join('');
        } else {
            lapsContainer.style.display = 'none';
            list.innerHTML = '';
        }
    };
    
    // --- STUDY ROOMS ---
    const renderParticipants = (participants: {[key: string]: RoomParticipant}) => {
        const list = $('#participant-list');
        if (!list) return;
        
        const sortedParticipants = Object.values(participants).sort((a, b) => a.joinedAt - b.joinedAt);

        list.innerHTML = sortedParticipants.map(data => `
            <li class="participant-item">
                <span class="participant-name">${data.user}</span>
                <span class="participant-status">${data.status || 'Idle'}</span>
            </li>
        `).join('');
    };

    const renderSingleChatMessage = (message) => {
        const container = $('#chat-messages');
        if (!container) return;
        
        const isSelf = message.user === state.profile.username;
        const msgEl = document.createElement('div');
        msgEl.className = `chat-message ${isSelf ? 'self' : 'other'}`;
        
        const safeText = message.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        msgEl.innerHTML = `
            ${!isSelf ? `<p class="message-sender">${message.user}</p>` : ''}
            <p>${safeText}</p>
        `;
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
    };

    // --- Room's Local Timer Logic ---
    const renderRoomTimerDisplay = () => {
        const time = state.room.timeRemaining;
        const minutes = String(Math.floor(time / 60)).padStart(2, '0');
        const seconds = String(Math.floor(time % 60)).padStart(2, '0');
        const display = `${minutes}:${seconds}`;
        $('#room-timer-display').textContent = display;
        if(state.ui.currentPage === 'rooms' && state.ui.currentRoomId) {
            document.title = `${display} - ${state.ui.currentRoomId}`;
        }
    };
    
    const switchRoomTimerMode = (mode) => {
        if (state.room.isRunning) {
             if(!confirm("A timer is running. Are you sure you want to switch and reset?")) return;
             pauseRoomTimer(true);
        }
        state.room.mode = mode;
        state.room.timeRemaining = state.pomodoro.settings[mode] * 60;

        $$('#room-pomodoro-modes .pomodoro-mode').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        renderRoomTimerDisplay();
    };

    const startRoomTimer = async () => {
        if (state.room.isRunning) return;
        state.room.isRunning = true;
        
        const status = state.room.mode === 'focus' ? 'Focusing' : 'On Break';
        updatePresence(status);
        
        $('#room-play-icon').style.display = 'none';
        $('#room-pause-icon').style.display = 'block';

        state.room.timerId = setInterval(() => {
            state.room.timeRemaining--;
            renderRoomTimerDisplay();
            if (state.room.timeRemaining <= 0) {
                finishRoomSession();
            }
        }, 1000);
    };

    const pauseRoomTimer = async (logSession = true) => {
        if (!state.room.isRunning) return;
        state.room.isRunning = false;
        clearInterval(state.room.timerId);
        state.room.timerId = null;

        if (logSession) {
            const initialDuration = state.pomodoro.settings[state.room.mode] * 60;
            const elapsedSeconds = initialDuration - state.room.timeRemaining;
            
            if (state.room.mode === 'focus' && elapsedSeconds > 60) {
                await logSessionFromRoom(Math.round(elapsedSeconds / 60));
            }
        }
        
        updatePresence('Idle');

        $('#room-play-icon').style.display = 'block';
        $('#room-pause-icon').style.display = 'none';
    };

    const finishRoomSession = async () => {
        pauseRoomTimer(false);

        const durationMinutes = state.pomodoro.settings[state.room.mode];
        if (state.room.mode === 'focus' && durationMinutes > 0) {
            await logSessionFromRoom(durationMinutes);
        }

        playAlarm();
        const notificationTitle = state.room.mode === 'focus' ? 'Focus complete!' : 'Break is over!';
        const nextMode = state.room.mode === 'focus' ? 'short' : 'focus';
        const notificationBody = nextMode === 'focus' ? 'Time to get back to work!' : 'Time for a short break!';
        showNotification(notificationTitle, { body: notificationBody });

        switchRoomTimerMode(nextMode);
    };
    
    const logSessionFromRoom = async (durationMinutes) => {
        const subjectId = $('#room-subject').value || null;
        if (subjectId) {
             const session = {
                user_id: state.currentUser.id,
                subject_id: subjectId,
                duration: durationMinutes,
                date: new Date().toISOString()
            };
            const { data, error } = await supabase.from('sessions').insert(session).select().single();
            if (data) state.sessions.unshift(data);

            await updateGamificationState();
            renderDashboardProgressWidget();
        }
    };


    // --- UTILITY FUNCTIONS ---
    const requestNotificationPermission = async () => {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') return;
        if (Notification.permission !== 'denied') {
            await Notification.requestPermission();
        }
    };
    
    const showNotification = (title, options) => {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, options);
        }
    };

    const getSubjectById = (id) => state.subjects.find(s => s.id == id);
    const getSubjectNameById = (id) => getSubjectById(id)?.name;
    const playAlarm = () => {
        const alarm = $('#alarm-sound');
        alarm.currentTime = 0;
        alarm.play().catch(error => console.warn("Alarm play was interrupted or failed:", error.message));
    };
    const formatStopwatchTime = (time) => {
        const hours = String(Math.floor(time / 3600000)).padStart(2, '0');
        const minutes = String(Math.floor((time % 3600000) / 60000)).padStart(2, '0');
        const seconds = String(Math.floor((time % 60000) / 1000)).padStart(2, '0');
        const ms = String(Math.floor((time % 1000) / 10)).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}.${ms}`;
    };
    const formatMinutes = (minutes) => {
        if (minutes < 60) return `${Math.round(minutes)}m`;
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours}h ${mins > 0 ? `${mins}m` : ''}`.trim();
    };

    const getTotalStudyMinutes = (state) => state.sessions.reduce((total, s) => total + Number(s.duration || 0), 0);

    const getStudyMinutesForMonth = (subjectId) => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);
        
        return state.sessions
            .filter(s => {
                const sessionDate = new Date(s.date);
                return s.subject_id == subjectId && sessionDate >= startOfMonth && sessionDate <= endOfMonth;
            })
            .reduce((total, s) => total + Number(s.duration || 0), 0);
    };
    
    // --- Achievement Definitions ---
    const ACHIEVEMENTS_LIST = {
        'time_1': { name: 'First Hour', description: 'Study for 1 hour', icon: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path>', condition: (s) => getTotalStudyMinutes(s) >= 60 },
        'time_10': { name: 'Dedicated', description: 'Study for 10 hours', icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"></path>', condition: (s) => getTotalStudyMinutes(s) >= 600 },
        'time_50': { name: 'Scholar', description: 'Study for 50 hours', icon: '<path d="M20.55 5.22l-1.39-1.68C18.45 2.43 17.2 2 16 2H8c-1.2 0-2.45.43-3.16 1.54l-1.39 1.68C2.66 6.33 2 7.78 2 9.25V19c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9.25c0-1.47-.66-2.92-1.45-4.03zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5.39C5.57 4.8 6.27 4.4 7 4.4h10c.73 0 1.43.4 1.88.99L20 6.6H4l1.12-1.21z"></path>', condition: (s) => getTotalStudyMinutes(s) >= 3000 },
        'time_100': { name: 'Master', description: 'Study for 100 hours', icon: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"></path>', condition: (s) => getTotalStudyMinutes(s) >= 6000 },
        'streak_3': { name: 'On a Roll', description: '3-day study streak', icon: '<path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path>', condition: (s) => s.streak.current >= 3 },
        'streak_7': { name: 'Committed', description: '7-day study streak', icon: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm-1-7.08l4.95 4.95 1.41-1.41-4.95-4.95-2.12 2.12 2.12-2.12c-1.48-.82-3.22-.82-4.7 0L2.5 12.3l1.41 1.41L7 10.6l2.83 2.83L11 12.92v-1z" opacity=".3"></path><path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 9.08l-2.12-2.12-1.41 1.41L10.3 16.2l4.95-4.95-1.41-1.41L11 12.92V6.5c1.48.82 3.22.82 4.7 0l2.12-2.12-1.41-1.41L13.5 5.8c-1.12-.62-2.43-.8-3.79-.58"></path>', condition: (s) => s.streak.current >= 7 },
        'streak_30': { name: 'Unstoppable', description: '30-day study streak', icon: '<path d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.69L1 12l2.44 2.79-.34 3.69 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.69L23 12zm-10 5h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z"></path>', condition: (s) => s.streak.current >= 30 },
        'sessions_10': { name: 'Focused', description: '10 focus sessions', icon: '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path>', condition: (s) => s.sessions.length >= 10 },
        'sessions_50': { name: 'Deep Work', description: '50 focus sessions', icon: '<path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"></path>', condition: (s) => s.sessions.length >= 50 },
    };

    // --- EVENT LISTENERS ---
    const setupEventListeners = () => {
         // --- Auth ---
        $('#signin-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('#signin-email').value;
            const password = $('#signin-password').value;
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) $('#auth-error').textContent = error.message;
            else $('#auth-error').textContent = '';
        });

        $('#signup-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = $('#signup-username').value;
            const email = $('#signup-email').value;
            const password = $('#signup-password').value;
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { username } }
            });
             if (error) $('#auth-error').textContent = error.message;
             else $('#auth-error').textContent = 'Check your email for a verification link!';
        });

        $('#show-signup').addEventListener('click', (e) => {
            e.preventDefault();
            $('#signin-form').classList.remove('active');
            $('#signup-form').classList.add('active');
            $('#auth-error').textContent = '';
        });

         $('#show-signin').addEventListener('click', (e) => {
            e.preventDefault();
            $('#signup-form').classList.remove('active');
            $('#signin-form').classList.add('active');
            $('#auth-error').textContent = '';
        });
        
        $('#logout-btn').addEventListener('click', handleSignOut);
        
        // --- Navigation ---
        const handleNavClick = (e) => {
            const link = e.target.closest('.nav-link, .bottom-nav-link');
            if (link) { 
                e.preventDefault(); 
                navigateToPage(link.dataset.page); 
            }
        };
        $('.sidebar .nav-list').addEventListener('click', handleNavClick);
        $('.bottom-nav').addEventListener('click', handleNavClick);
        $('#more-nav-list').addEventListener('click', handleNavClick);


        $('.menu-toggle').addEventListener('click', toggleSidebar);
        $('.sidebar-overlay').addEventListener('click', toggleSidebar);

        document.body.addEventListener('click', (e) => {
            if ((e.target as Element).matches('.modal-container:not(#log-session-modal) .modal-close-btn, .modal-container:not(#log-session-modal) .modal-cancel-btn')) {
                hideAllModals();
            }
            if ((e.target as Element).closest('#gemini-suggest-btn')) {
                getStudyBreakSuggestion();
            }
        });
        
        // --- Subjects ---
        const openSubjectModal = () => {
            $('#subject-form').reset();
            $('#subject-id').value = '';
            $('#subject-modal-title').textContent = 'New Subject';
            $('#subject-color-picker .color-swatch.active')?.classList.remove('active');
            showModal('subject-modal');
        };
        
        $('#main-header-content').addEventListener('click', (e) => {
             if (e.target.closest('#add-subject-btn')) openSubjectModal();
             if (e.target.closest('#new-note-btn')) openNoteModal();
        });
        $('#add-subject-btn, #subjects-fab').addEventListener('click', openSubjectModal);

        $('#subjects-grid').addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-subject-btn');
            const deleteBtn = e.target.closest('.delete-subject-btn');
            if (editBtn) {
                const subject = getSubjectById(editBtn.dataset.id);
                if(subject) {
                   $('#subject-id').value = subject.id;
                   $('#subject-name').value = subject.name;
                   $('#subject-goal').value = subject.goal;
                   $('#subject-modal-title').textContent = 'Edit Subject';
                   $$('#subject-color-picker .color-swatch').forEach(sw => {
                       sw.classList.toggle('active', sw.style.backgroundColor === subject.color);
                   });
                   showModal('subject-modal');
                }
            }
            if (deleteBtn) {
                state.deleteContext = { type: 'subject', id: deleteBtn.dataset.id };
                showModal('delete-modal');
            }
        });
        $('#subject-form').addEventListener('submit', handleSubjectForm);

         // --- Notes ---
        const openNoteModal = () => {
            $('#note-form').reset();
            $('#note-id').value = '';
            $('#note-modal-title').textContent = 'New Note';
            $('#note-content-editor').innerHTML = '';
            showModal('note-modal');
        };

        $('#new-note-btn').addEventListener('click', openNoteModal);

        $('#notes-list').addEventListener('click', (e) => {
            const noteItem = e.target.closest('.note-item');
            if (noteItem) {
                state.ui.selectedNoteId = parseInt(noteItem.dataset.id);
                renderNotes();
                 if (window.innerWidth <= 992) {
                   $('#notes-layout').classList.add('viewing-note');
                }
            }
        });
        $('#note-view-panel').addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-note-btn');
            const deleteBtn = e.target.closest('.delete-note-btn');
            const backBtn = e.target.closest('.back-to-list-btn');
            if (editBtn) {
                const note = state.notes.find(n => n.id == editBtn.dataset.id);
                if (note) {
                    $('#note-id').value = note.id;
                    $('#note-title').value = note.title;
                    $('#note-subject').value = note.subject_id;
                    $('#note-content-editor').innerHTML = note.content;
                    $('#note-modal-title').textContent = 'Edit Note';
                    showModal('note-modal');
                }
            }
            if (deleteBtn) {
                state.deleteContext = { type: 'note', id: deleteBtn.dataset.id };
                showModal('delete-modal');
            }
            if (backBtn) {
                 $('#notes-layout').classList.remove('viewing-note');
                 state.ui.selectedNoteId = null;
                 renderNotes();
            }
        });
        $('#notes-search-bar').addEventListener('input', renderNotes);
        $('#note-form').addEventListener('submit', handleNoteForm);
        $('.editor-toolbar').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if(btn && btn.dataset.command) {
                document.execCommand(btn.dataset.command, false, null);
                $('#note-content-editor').focus();
            }
        });

        // --- Reminders / Calendar ---
        $('#add-reminder-from-dash').addEventListener('click', () => {
            $('#reminder-form').reset();
            $('#reminder-id').value = '';
            $('#reminder-date').value = new Date().toISOString().slice(0, 10);
            $('#reminder-modal-title').textContent = 'New Reminder';
            $('#reminder-form button[type="submit"]').textContent = 'Add Reminder';
            showModal('reminder-modal');
        });
        $('#reminder-form').addEventListener('submit', handleReminderForm);
        
        $('#dashboard-reminder-list').addEventListener('click', async (e) => {
            const reminderId = e.target.closest('.reminder-item')?.dataset.id || (e.target as HTMLElement).dataset.reminderId;
            if (!reminderId) return;

            const target = e.target as HTMLInputElement;
            if (target.matches('.reminder-checkbox')) {
                const reminder = state.reminders.find(r => r.id == reminderId);
                if (reminder) {
                    reminder.completed = target.checked;
                    await supabase.from('reminders').update({ completed: target.checked }).eq('id', reminderId);
                    renderDashboardReminders();
                    renderCalendar();
                }
            } else if (target.closest('.edit-reminder-btn')) {
                const reminder = state.reminders.find(r => r.id == reminderId);
                if(reminder) {
                    $('#reminder-id').value = reminder.id;
                    $('#reminder-title').value = reminder.title;
                    $('#reminder-subject').value = reminder.subject_id;
                    $('#reminder-date').value = reminder.date;
                    $('#reminder-modal-title').textContent = 'Edit Reminder';
                    $('#reminder-form button[type="submit"]').textContent = 'Save Changes';
                    showModal('reminder-modal');
                }
            } else if (target.closest('.delete-reminder-btn')) {
                 state.deleteContext = { type: 'reminder', id: reminderId };
                 showModal('delete-modal');
            }
        });

        $('#calendar-container').addEventListener('click', (e) => {
            const reminderItem = (e.target as Element).closest('.reminder-item-calendar');
            if (reminderItem) {
                const reminder = state.reminders.find(r => r.id == (reminderItem as HTMLElement).dataset.reminderId);
                if (reminder) {
                     $('#reminder-id').value = reminder.id;
                    $('#reminder-title').value = reminder.title;
                    $('#reminder-subject').value = reminder.subject_id;
                    $('#reminder-date').value = reminder.date;
                    $('#reminder-modal-title').textContent = 'Edit Reminder';
                    $('#reminder-form button[type="submit"]').textContent = 'Save Changes';
                    showModal('reminder-modal');
                }
                return;
            }

            const dayCell = (e.target as Element).closest('.calendar-day');
            if (dayCell && (dayCell as HTMLElement).dataset.date) {
                state.ui.selectedDate = (dayCell as HTMLElement).dataset.date;
                $('#reminder-form').reset();
                $('#reminder-id').value = '';
                $('#reminder-date').value = state.ui.selectedDate;
                $('#reminder-modal-title').textContent = 'New Reminder';
                $('#reminder-form button[type="submit"]').textContent = 'Add Reminder';
                showModal('reminder-modal');
            }
        });
        
         // --- Exam ---
        $('#exam-widget').addEventListener('click', () => {
             $('#exam-form').reset();
             if(state.nextExam) {
                $('#exam-title').value = state.nextExam.title;
                $('#exam-subject').value = state.nextExam.subjectId;
                $('#exam-date').value = state.nextExam.date;
                $('#remove-exam-btn').style.display = 'block';
             } else {
                $('#remove-exam-btn').style.display = 'none';
             }
            showModal('exam-modal');
        });
        $('#exam-form').addEventListener('submit', handleExamForm);
        $('#remove-exam-btn').addEventListener('click', async () => {
            const { error } = await supabase.from('profiles').update({ next_exam: null }).eq('id', state.currentUser.id);
            if (!error) {
                state.nextExam = null;
                renderNextExam();
            }
            hideModal('exam-modal');
        });

        // --- Pomodoro ---
        $('.pomodoro-modes').addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.matches('.pomodoro-mode') && target.dataset.mode) {
                switchPomodoroMode(target.dataset.mode);
            }
        });
        $('#play-pause-btn').addEventListener('click', () => {
            state.pomodoro.isRunning ? pauseTimer() : requestNotificationPermission().then(startTimer);
        });
        $('#skip-btn').addEventListener('click', () => finishSession(true));
        $('#reset-btn').addEventListener('click', resetTimer);

        // --- Study Rooms Listeners ---
        $('#join-room-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const roomName = $('#room-name-input').value.trim();
            if(roomName) joinRoom(roomName);
        });
        $('#room-leave-btn').addEventListener('click', leaveRoom);

        $('#chat-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const text = $('#chat-input').value.trim();
            if(text) {
                sendChatMessage(text);
                $('#chat-input').value = '';
            }
        });
         $('#room-play-pause-btn').addEventListener('click', () => {
            state.room.isRunning ? pauseRoomTimer(true) : startRoomTimer();
        });
        $('#room-pomodoro-modes').addEventListener('click', (e) => {
            const modeBtn = (e.target as Element).closest('.pomodoro-mode') as HTMLElement;
            if(modeBtn && modeBtn.dataset.mode) {
                switchRoomTimerMode(modeBtn.dataset.mode);
            }
        });


        // --- Custom Timer ---
        $('#timer-start-btn').addEventListener('click', () => {
            requestNotificationPermission().then(startCustomTimer);
        });
        $('#timer-pause-btn').addEventListener('click', pauseCustomTimer);
        $('#timer-reset-btn').addEventListener('click', resetCustomTimer);

        // --- Stopwatch ---
        $('#stopwatch-start-btn').addEventListener('click', startStopwatch);
        $('#stopwatch-stop-btn').addEventListener('click', stopStopwatch);
        $('#stopwatch-reset-btn').addEventListener('click', resetStopwatch);
        $('#stopwatch-lap-btn').addEventListener('click', addLap);

        // --- Settings ---
        $('#dark-mode-toggle').addEventListener('change', async (e) => {
            state.settings.darkMode = (e.target as HTMLInputElement).checked;
            applySettings();
            await supabase.from('profiles').update({ settings: state.settings }).eq('id', state.currentUser.id);
        });
        $('#color-palette').addEventListener('click', async (e) => {
            const swatch = (e.target as Element).closest('.color-swatch') as HTMLElement;
            if (swatch) {
                state.settings.accentTheme = swatch.dataset.color;
                applySettings();
                await supabase.from('profiles').update({ settings: state.settings }).eq('id', state.currentUser.id);
            }
        });
        $('#subject-color-picker').addEventListener('click', (e) => {
            const swatch = (e.target as Element).closest('.color-swatch');
            if (swatch) {
                $('#subject-color-picker .color-swatch.active')?.classList.remove('active');
                swatch.classList.add('active');
            }
        });
        $('#setting-focus-time, #setting-short-break-time, #setting-long-break-time').addEventListener('change', async (e) => {
            const target = e.target as HTMLInputElement;
            const value = parseInt(target.value);
            if (value > 0) {
                if (target.id === 'setting-focus-time') state.pomodoro.settings.focus = value;
                if (target.id === 'setting-short-break-time') state.pomodoro.settings.short = value;
                if (target.id === 'setting-long-break-time') state.pomodoro.settings.long = value;
                
                // Here you would save pomodoro settings to the user's profile in Supabase if you add it to the schema.
                
                updatePomodoroModeButtons();
                if (!state.pomodoro.isRunning) {
                   resetTimer();
                }
            }
        });

        // --- Delete Confirmation ---
        $('#confirm-delete-btn').addEventListener('click', async () => {
            const { type, id } = state.deleteContext;
            let error;
            if (type === 'subject') {
                ({ error } = await supabase.from('subjects').delete().eq('id', id));
                if (!error) {
                    state.subjects = state.subjects.filter(s => s.id != id);
                    renderSubjects();
                    populateSubjectDropdowns();
                }
            } else if (type === 'note') {
                 ({ error } = await supabase.from('notes').delete().eq('id', id));
                 if (!error) {
                    state.notes = state.notes.filter(n => n.id != id);
                    if (state.ui.selectedNoteId == id) state.ui.selectedNoteId = null;
                    renderNotes();
                 }
            } else if (type === 'reminder') {
                ({ error } = await supabase.from('reminders').delete().eq('id', id));
                if (!error) {
                    state.reminders = state.reminders.filter(p => p.id != id);
                    renderDashboardReminders();
                    renderCalendar();
                }
            }
            if(error) console.error(`Error deleting ${type}:`, error);
            hideModal('delete-modal');
        });
        
        // --- Log Session Confirmation ---
        $('#confirm-log-session-btn').addEventListener('click', async () => {
            const { durationMinutes, subjectId } = state.logSessionContext;
            if (durationMinutes > 0 && subjectId) {
                 const session = {
                    user_id: state.currentUser.id,
                    subject_id: subjectId,
                    duration: durationMinutes,
                    date: new Date().toISOString()
                };
                const { data, error } = await supabase.from('sessions').insert(session).select().single();
                if(data) state.sessions.unshift(data);

                await updateGamificationState();

                renderSessions();
                renderSubjects();
                renderDashboardProgressWidget();
            }
            hideModal('log-session-modal');
            state.logSessionContext = { type: null, durationMinutes: 0, subjectId: null };
        });
        $('#log-session-modal').addEventListener('click', (e) => {
            if ((e.target as Element).matches('.modal-close-btn, .modal-cancel-btn')) {
                hideModal('log-session-modal');
                state.logSessionContext = { type: null, durationMinutes: 0, subjectId: null };
            }
        });
    };
    
    // --- Navigation Rendering ---
    const NAV_ITEMS = [
        { id: 'dashboard', label: 'Dashboard', icon: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"></path>', mobile: true },
        { id: 'rooms', label: 'Study Rooms', icon: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path>', mobile: true },
        { id: 'calendar', label: 'Calendar', icon: '<path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"></path>', mobile: true },
        { id: 'sessions', label: 'Sessions', icon: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"></path><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path>', mobile: false },
        { id: 'analytics', label: 'Analytics', icon: '<path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"></path>', mobile: false },
        { id: 'timer', label: 'Timer', icon: '<path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"></path>', mobile: false },
        { id: 'stopwatch', label: 'Stopwatch', icon: '<path d="M12 6c-3.86 0-7 3.14-7 7s3.14 7 7 7 7-3.14 7-7-3.14-7-7-7zm0 12c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"></path><path d="M11 1h2v3h-2zM4.93 4.93l1.41 1.41-1.06 1.06-1.41-1.41zM19.07 4.93l-1.41 1.41 1.06 1.06 1.41-1.41zM10.4 12.4L13 15v-5h-2.6z"></path>', mobile: false },
        { id: 'notes', label: 'Notes', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path>', mobile: false },
        { id: 'subjects', label: 'Subjects', icon: '<path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"></path>', mobile: false },
        { id: 'settings', label: 'Settings', icon: '<path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"></path>', mobile: false },
    ];

    const renderNavigation = () => {
        const sidebarList = $('.sidebar .nav-list');
        const bottomNav = $('.bottom-nav');
        const moreList = $('#more-nav-list');

        sidebarList.innerHTML = NAV_ITEMS.map(item => `
            <li class="nav-item">
                <a href="#" class="nav-link" data-page="${item.id}">
                    <svg class="nav-icon" viewBox="0 0 24 24">${item.icon}</svg>
                    <span>${item.label}</span>
                </a>
            </li>
        `).join('');
        
        const mobileNavItems = NAV_ITEMS.filter(item => item.mobile);
        const moreNavItems = NAV_ITEMS.filter(item => !item.mobile);
        
        bottomNav.innerHTML = mobileNavItems.map(item => `
             <a href="#" class="bottom-nav-link" data-page="${item.id}">
                <svg class="nav-icon" viewBox="0 0 24 24">${item.icon}</svg>
                <span class="nav-label">${item.label}</span>
            </a>
        `).join('') + `
            <a href="#" class="bottom-nav-link" data-page="more">
                <svg class="nav-icon" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"></path></svg>
                <span class="nav-label">More</span>
            </a>
        `;
        
        moreList.innerHTML = moreNavItems.map(item => `
             <li class="nav-item">
                <a href="#" class="nav-link" data-page="${item.id}">
                    <svg class="nav-icon" viewBox="0 0 24 24">${item.icon}</svg>
                    <span>${item.label}</span>
                </a>
            </li>
        `).join('');
    };


    // --- INITIALIZATION ---
    const init = () => {
        // Auth state change listener
        supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                state.currentUser = session.user;
                hideLoginScreen();
                loadAllDataForUser();
            } else {
                state.currentUser = null;
                showLoginScreen();
            }
        });

        setupEventListeners();
        createColorSwatches();
        applySettings();
    };

    init();
});
