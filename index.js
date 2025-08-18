
// Supabase Client
const { createClient } = window.supabase;
const supabaseUrl = 'https://gldcodlptflzpvbiquxp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsZGNvZGxwdGZsenB2YmlxdXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDE2NzMsImV4cCI6MjA3MTAxNzY3M30.CwpFG_y3z-hLl7D0yddfc8psRrn1RBZbzkJa1x-rOlU';
const supabase = createClient(supabaseUrl, supabaseKey);

// Gemini AI Client
// Assume process.env is available
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

    // --- NAVIGATION CONFIG ---
    const NAV_ITEMS = [
        { id: 'dashboard', label: 'Dashboard', icon: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"></path>', type: 'main' },
        { id: 'rooms', label: 'Study Rooms', icon: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"></path>', type: 'main' },
        { id: 'calendar', label: 'Calendar', icon: '<path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"></path>', type: 'main' },
        { id: 'more', label: 'More', icon: '<path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"></path>', type: 'main' },
        { id: 'sessions', label: 'Session History', icon: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"></path><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path>', type: 'secondary' },
        { id: 'analytics', label: 'Analytics', icon: '<path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"></path>', type: 'secondary' },
        { id: 'timer', label: 'Timer', icon: '<path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"></path>', type: 'secondary' },
        { id: 'stopwatch', label: 'Stopwatch', icon: '<path d="M22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72zM7.88 3.39L6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37V8zM12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>', type: 'secondary' },
        { id: 'notes', label: 'Notes', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path>', type: 'secondary' },
        { id: 'subjects', label: 'Subjects', icon: '<path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V5h10v6z"></path>', type: 'secondary' },
        { id: 'settings', label: 'Settings', icon: '<path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18-.49.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61.22l2 3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"></path>', type: 'secondary' },
    ];
    
    const ACHIEVEMENTS_CONFIG = {
        'first_session': {
            name: 'First Step',
            description: 'Complete your first study session.',
            icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path>',
            condition: ({ totalSessions }) => totalSessions >= 1,
        },
        'study_hour': {
            name: 'Time Keeper',
            description: 'Study for a total of 1 hour.',
            icon: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"></path><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path>',
            condition: ({ totalMinutes }) => totalMinutes >= 60,
        },
        'ten_hours': {
            name: 'Dedicated Learner',
            description: 'Study for a total of 10 hours.',
            icon: '<path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 14-6-4.5 6-4.5v9zM19 18h-6V6h6v12z"></path>',
            condition: ({ totalMinutes }) => totalMinutes >= 600,
        },
        'streak_3': {
            name: 'On a Roll',
            description: 'Maintain a 3-day study streak.',
            icon: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>',
            condition: ({ streak }) => streak.current >= 3,
        },
        'streak_7': {
            name: 'Week Warrior',
            description: 'Maintain a 7-day study streak.',
            icon: '<path d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5l-1.89 3.2-3.61.82.34 3.69L1 12l2.44 2.79-.34 3.69 3.61.82 1.89 3.2L12 21.04l3.4 1.45 1.89-3.2 3.61-.82-.34-3.69L23 12zm-10 5h-2v-2h2v2zm0-4h-2v-4h2v4z"></path>',
            condition: ({ streak }) => streak.current >= 7,
        },
        'subject_master': {
            name: 'Subject Specialist',
            description: 'Study one subject for over 5 hours.',
            icon: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 16h2v-6h-2v6zm0-8h2V7h-2v2z"></path>',
            condition: ({ sessions, subjects }) => {
                const minutesBySubject = {};
                sessions.forEach(s => {
                    if(s.subject_id) {
                        minutesBySubject[s.subject_id] = (minutesBySubject[s.subject_id] || 0) + s.duration;
                    }
                });
                return Object.values(minutesBySubject).some(minutes => minutes >= 300);
            }
        }
    };

    // --- SUPABASE REAL-TIME SERVICE ---
    let roomChannel = null;
    let roomParticipants = {};
    
    const joinRoom = async (roomId) => {
        if (!state.currentUser || !state.profile?.username) return;
        
        // If already in a room, leave it first.
        if (roomChannel) {
            await leaveRoom();
        }

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
                const pres = presenceState[id][0];
                roomParticipants[id] = { user: pres.user, status: pres.status, joinedAt: pres.joinedAt };
            }
            renderParticipants(roomParticipants);
        });

        channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
            renderSingleChatMessage(payload);
        });

        channel.subscribe(async (status, err) => {
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
                 console.error(`Failed to subscribe to channel '${roomId}'. Status: ${status}`, err);
                 alert(`Could not connect to the study room. Status: ${status}. Please check your connection and try again.`);
                 await leaveRoom();
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
        
        // Show skeleton loader for dashboard
        const skeleton = $('#dashboard-skeleton');
        const contentGrid = $('#dashboard-grid-content');
        if (state.ui.currentPage === 'dashboard' && skeleton && contentGrid) {
            skeleton.style.display = 'grid';
            contentGrid.style.display = 'none';
        }

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
        
        // Hide skeleton and show content
        if (skeleton && contentGrid) {
            skeleton.style.display = 'none';
            contentGrid.style.display = 'grid';
        }

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
        updateCustomTimerDisplay();
    };
    
    const toggleSidebar = () => {
        state.ui.sidebarOpen = !state.ui.sidebarOpen;
        $('.sidebar').classList.toggle('open', state.ui.sidebarOpen);
        $('.sidebar-overlay').classList.toggle('active', state.ui.sidebarOpen);
    }
    
    const MAIN_NAV_PAGES = ['dashboard', 'rooms', 'calendar', 'more'];
    const SECONDARY_NAV_PAGES = ['sessions', 'analytics', 'timer', 'stopwatch', 'notes', 'subjects', 'settings'];

    const renderNavigation = () => {
        const pageId = state.ui.currentPage;
        
        // Sidebar links and "More" page list links
        $$('.sidebar .nav-link, #more-nav-list .nav-link').forEach((l) => {
            l.classList.toggle('active', l.dataset.page === pageId);
        });

        // Bottom nav links
        $$('.bottom-nav-link').forEach((l) => {
            const isSecondary = SECONDARY_NAV_PAGES.includes(pageId);
            const shouldBeActive = 
                (isSecondary && l.dataset.page === 'more') || 
                (!isSecondary && l.dataset.page === pageId);
            l.classList.toggle('active', shouldBeActive);
        });
    };

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
        
        renderNavigation();

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

    // --- CUSTOM TIMER ---
    const updateCustomTimerDisplay = () => {
        const display = $('#custom-timer-display');
        if (!display) return;
    
        const totalSeconds = state.timer.timeRemaining > 0 ? state.timer.timeRemaining : (
            (parseInt($('#timer-hours').value, 10) || 0) * 3600 +
            (parseInt($('#timer-minutes').value, 10) || 0) * 60 +
            (parseInt($('#timer-seconds').value, 10) || 0)
        );
        
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        
        display.textContent = `${hours}:${minutes}:${seconds}`;
        if (state.timer.isRunning) {
            document.title = `${hours}:${minutes}:${seconds} - Timer`;
        }
    };
    
    const startCustomTimer = () => {
        if (state.timer.isRunning) return;
    
        // If timer is at 0, get values from input
        if (state.timer.timeRemaining <= 0) {
            const hours = parseInt($('#timer-hours').value, 10) || 0;
            const minutes = parseInt($('#timer-minutes').value, 10) || 0;
            const seconds = parseInt($('#timer-seconds').value, 10) || 0;
            const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
            
            if (totalSeconds <= 0) return; // Don't start a zero-second timer
    
            state.timer.timeRemaining = totalSeconds;
            state.timer.initialDuration = totalSeconds;
        }
        
        state.timer.isRunning = true;
        $('#timer-start-btn').disabled = true;
        $('#timer-pause-btn').disabled = false;
        $$('#custom-timer-form input').forEach(input => input.disabled = true);
    
        state.timer.timerId = setInterval(() => {
            state.timer.timeRemaining--;
            updateCustomTimerDisplay();
    
            if (state.timer.timeRemaining <= 0) {
                clearInterval(state.timer.timerId);
                state.timer.isRunning = false;
                
                // Log session automatically
                const durationMinutes = Math.round(state.timer.initialDuration / 60);
                if (durationMinutes > 0) {
                    state.logSessionContext = {
                        type: 'timer',
                        durationMinutes: durationMinutes,
                        subjectId: $('#timer-subject').value || null
                    };
                    showModal('log-session-modal');
                }
                
                // Reset UI
                $('#timer-start-btn').disabled = false;
                $('#timer-start-btn').textContent = 'Start';
                $('#timer-pause-btn').disabled = true;
                $$('#custom-timer-form input').forEach(input => input.disabled = false);
    
                playAlarm();
                showNotification("Timer Finished!", { body: "Your countdown timer has ended." });
            }
        }, 1000);
    };
    
    const pauseCustomTimer = () => {
        if (!state.timer.isRunning) return;
        state.timer.isRunning = false;
        clearInterval(state.timer.timerId);
        state.timer.timerId = null;
        $('#timer-start-btn').disabled = false;
        $('#timer-start-btn').textContent = 'Resume';
        $('#timer-pause-btn').disabled = true;
    };
    
    const resetCustomTimer = () => {
        pauseCustomTimer(); // Also clears interval
        state.timer.timeRemaining = 0;
        state.timer.initialDuration = 0;
        
        updateCustomTimerDisplay(); // Will read from inputs
        document.title = "NextChapter";
    
        $('#timer-start-btn').textContent = 'Start';
        $('#timer-start-btn').disabled = false;
        $('#timer-pause-btn').disabled = false; // Can be enabled
        $$('#custom-timer-form input').forEach(input => input.disabled = false);
    };

    // --- STOPWATCH ---
    const formatStopwatchTime = (time) => {
        const milliseconds = String(Math.floor((time % 1000) / 10)).padStart(2, '0');
        const totalSeconds = Math.floor(time / 1000);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0');
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    };
    
    const updateStopwatchDisplay = () => {
        if (!$('#stopwatch-display')) return;
        const now = performance.now();
        state.stopwatch.elapsedTime = state.stopwatch.isRunning 
            ? (now - state.stopwatch.startTime) 
            : state.stopwatch.elapsedTime;
        
        state.stopwatch.startTime = now; // For next frame calculation
        $('#stopwatch-display').textContent = formatStopwatchTime(state.stopwatch.elapsedTime);
    
        if (state.stopwatch.isRunning) {
            state.stopwatch.timerId = requestAnimationFrame(updateStopwatchDisplay);
        }
    };
    
    const startStopwatch = () => {
        if (state.stopwatch.isRunning) return;
        state.stopwatch.isRunning = true;
        state.stopwatch.startTime = performance.now() - state.stopwatch.elapsedTime;
        
        // Use a self-correcting interval for smoother display update
        const update = () => {
            const elapsedTime = performance.now() - state.stopwatch.startTime;
            $('#stopwatch-display').textContent = formatStopwatchTime(elapsedTime);
        };
        state.stopwatch.timerId = setInterval(update, 100);
        
        $('#stopwatch-start-btn').style.display = 'none';
        $('#stopwatch-stop-btn').style.display = 'inline-flex';
        $('#stopwatch-lap-btn').disabled = false;
    };
    
    const stopStopwatch = () => {
        if (!state.stopwatch.isRunning) return;
        
        const finalElapsedTime = performance.now() - state.stopwatch.startTime;
        state.stopwatch.isRunning = false;
        clearInterval(state.stopwatch.timerId);
        state.stopwatch.elapsedTime = finalElapsedTime; // Store final time
        $('#stopwatch-display').textContent = formatStopwatchTime(state.stopwatch.elapsedTime);
        
        $('#stopwatch-start-btn').style.display = 'inline-flex';
        $('#stopwatch-stop-btn').style.display = 'none';
        $('#stopwatch-lap-btn').disabled = true;
    
        // Prompt to log session
        const durationMinutes = Math.round(state.stopwatch.elapsedTime / (1000 * 60));
        if (durationMinutes > 0) {
            state.logSessionContext = {
                type: 'stopwatch',
                durationMinutes,
                subjectId: $('#stopwatch-subject').value || null
            };
            showModal('log-session-modal');
        }
    };
    
    const lapStopwatch = () => {
        if (!state.stopwatch.isRunning) return;
        const lapTime = performance.now() - state.stopwatch.startTime;
        state.stopwatch.laps.unshift(lapTime);
        renderLaps();
    };
    
    const resetStopwatch = () => {
        if(state.stopwatch.isRunning) stopStopwatch(); // stop first to prompt log
        state.stopwatch = getInitialState().stopwatch;
        renderLaps();
        $('#stopwatch-display').textContent = formatStopwatchTime(0);
        $('#stopwatch-start-btn').style.display = 'inline-flex';
        $('#stopwatch-stop-btn').style.display = 'none';
    };
    
    const renderLaps = () => {
        const container = $('#laps-container');
        const list = $('#laps-list');
        if (!container || !list) return;
    
        if (state.stopwatch.laps.length === 0) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        list.innerHTML = state.stopwatch.laps.map((lap, index) => {
            const lastLapTime = state.stopwatch.laps[index + 1] || 0;
            const lapDuration = lap - lastLapTime;
            return `
            <li class="lap-item">
                <span class="lap-number">Lap ${state.stopwatch.laps.length - index}</span>
                <span class="lap-duration">(+${formatStopwatchTime(lapDuration)})</span>
                <span class="lap-time">${formatStopwatchTime(lap)}</span>
            </li>
        `}).join('');
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
                <h3>No exam scheduled</h3>
                <p>Click to set one.</p>
            `;
            return;
        }
        
        widget.classList.remove('no-exam');
        const examDate = new Date(state.nextExam.date + 'T00:00:00');
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const diffTime = examDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const subject = getSubjectById(state.nextExam.subject_id);

        widget.innerHTML = `
            <div class="widget-header">
                <div class="exam-widget-header">
                    <svg class="nav-icon" viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"></path></svg>
                    <span>Next Exam</span>
                </div>
                <button id="edit-exam-btn" class="widget-action-btn" aria-label="Edit exam">
                     <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>
                </button>
            </div>
            <span class="days">${diffDays >= 0 ? diffDays : 0}</span>
            <span class="days-label">day${diffDays !== 1 ? 's' : ''} left</span>
            <h4 class="exam-title">${state.nextExam.title}</h4>
             ${subject ? `<span id="exam-subject-tag" style="background-color: ${subject.color}1A; color: ${subject.color};">${subject.name}</span>` : ''}
        `;
    };
    
    const handleExamForm = async (e) => {
        e.preventDefault();
        const examData = {
            title: $('#exam-title').value,
            subject_id: $('#exam-subject').value,
            date: $('#exam-date').value
        };
        
        state.nextExam = examData;
        
        const { error } = await supabase.from('profiles').update({ next_exam: examData }).eq('id', state.currentUser.id);
        if(error) console.error("Error updating exam:", error);
        
        renderNextExam();
        hideModal('exam-modal');
    };
    
    // --- GEMINI AI WIDGET ---
    const renderBreakSuggestionWidget = () => {
        const widget = $('#gemini-break-widget');
        if (!widget) return;

        let contentHTML = '';
        if (state.ui.breakSuggestion.loading) {
            contentHTML = `<div class="gemini-suggestion-content"><div class="gemini-loading-spinner"></div></div>`;
        } else if (state.ui.breakSuggestion.error) {
             contentHTML = `<div class="gemini-suggestion-content"><p class="placeholder-text" style="color:var(--red);">${state.ui.breakSuggestion.error}</p></div>`;
        } else if (state.ui.breakSuggestion.suggestions) {
            contentHTML = `<div class="gemini-suggestion-result"><ul>${state.ui.breakSuggestion.suggestions.map(s => `<li><strong>${s.title}</strong> ${s.description}</li>`).join('')}</ul></div>`;
        } else {
            contentHTML = `<p>Feeling stuck? Let AI suggest a short (5-10 min) break to refresh your mind.</p>`;
        }
        
        widget.innerHTML = `
            <div class="gemini-widget-header">
                <h3>AI Break Suggester</h3>
                <span style="font-size:12px; font-weight:bold; background: linear-gradient(to right, #4285F4, #9B72CB, #D96570, #F2A60F); -webkit-background-clip: text; color: transparent;">GEMINI</span>
            </div>
            ${contentHTML}
            <button id="suggest-break-btn" class="btn btn-primary" style="margin-top: auto;" ${state.ui.breakSuggestion.loading ? 'disabled' : ''}>✨ Suggest a Break</button>
        `;
    }

    const fetchBreakSuggestion = async () => {
        state.ui.breakSuggestion = { loading: true, suggestions: null, error: null };
        renderBreakSuggestionWidget();

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: "Suggest 3 unique, short (5-10 minute) study break ideas that help get away from the screen. Format as a JSON array where each object has a 'title' and 'description' key.",
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING },
                                description: { type: Type.STRING }
                            }
                        }
                    }
                }
            });
            
            const jsonResponse = JSON.parse(response.text);
            state.ui.breakSuggestion.suggestions = jsonResponse;

        } catch (e) {
            console.error("Gemini API Error:", e);
            state.ui.breakSuggestion.error = "Could not fetch suggestions.";
        } finally {
            state.ui.breakSuggestion.loading = false;
            renderBreakSuggestionWidget();
        }
    };

    // --- ANALYTICS / GAMIFICATION ---
    const renderDashboardProgressWidget = () => {
        const widget = $('#progress-widget');
        if (!widget) return;
        
        const todayMinutes = getStudyMinutesForDay(new Date());
        
        widget.innerHTML = `
            <h3>Today's Progress</h3>
            <div class="dashboard-progress-grid">
                <div class="dashboard-progress-item">
                    <div class="value">${formatMinutes(todayMinutes)}</div>
                    <div class="label">Time Studied</div>
                </div>
                <div class="dashboard-progress-item">
                    <div class="value">${state.streak.current} ${state.streak.current === 1 ? 'day' : 'days'}</div>
                    <div class="label">Study Streak</div>
                </div>
            </div>
             <button class="btn" id="view-analytics-btn" style="width: 100%; margin-top: 16px;">View Full Analytics</button>
        `;
    };
    
    const renderAnalyticsPage = () => {
        renderGamificationStats();
        renderHeatmap();
        renderSubjectPieChart();
        renderAchievements();
    };

    const renderGamificationStats = () => {
        const container = $('#gamification-stats');
        if(!container) return;

        const totalMinutes = state.sessions.reduce((sum, s) => sum + s.duration, 0);
        const totalSessions = state.sessions.length;

        container.innerHTML = `
            <div class="stat-card">
                <div class="value">${state.streak.current}</div>
                <div class="label">Current Streak</div>
            </div>
            <div class="stat-card">
                <div class="value">${formatMinutes(totalMinutes)}</div>
                <div class="label">Total Time Studied</div>
            </div>
            <div class="stat-card">
                <div class="value">${totalSessions}</div>
                <div class="label">Total Sessions</div>
            </div>
            <div class="stat-card">
                <div class="value">${state.achievements.length} / ${Object.keys(ACHIEVEMENTS_CONFIG).length}</div>
                <div class="label">Achievements</div>
            </div>
        `;
    };

    const renderHeatmap = () => {
        const container = $('#heatmap-container');
        if(!container) return;
        
        const today = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(today.getFullYear() - 1);
        
        const studyData = {};
        let maxMinutes = 0;
        state.sessions.forEach(s => {
            const dateStr = new Date(s.date).toISOString().slice(0, 10);
            studyData[dateStr] = (studyData[dateStr] || 0) + s.duration;
            if (studyData[dateStr] > maxMinutes) maxMinutes = studyData[dateStr];
        });
        
        let heatmapHTML = '';
        let currentDay = oneYearAgo;
        
        while (currentDay <= today) {
            const dateStr = currentDay.toISOString().slice(0, 10);
            const minutes = studyData[dateStr] || 0;
            let level = 0;
            if (minutes > 0) {
                const ratio = minutes / (maxMinutes > 0 ? maxMinutes : 1);
                if (ratio > 0.75) level = 4;
                else if (ratio > 0.5) level = 3;
                else if (ratio > 0.25) level = 2;
                else level = 1;
            }
            heatmapHTML += `<div class="heatmap-day" data-level="${level}">
                <div class="heatmap-tooltip">${dateStr}: ${minutes} min</div>
            </div>`;
            currentDay.setDate(currentDay.getDate() + 1);
        }
        container.innerHTML = heatmapHTML;
    };

    const renderSubjectPieChart = () => {
        const container = $('#subject-chart-container');
        if(!container) return;

        const totalMinutes = state.sessions.reduce((sum, s) => sum + s.duration, 0);
        if(totalMinutes === 0) {
            container.innerHTML = `<p class="placeholder-text">No session data to display chart.</p>`;
            return;
        }

        const minutesBySubject = {};
        state.sessions.forEach(s => {
            if(s.subject_id) {
                minutesBySubject[s.subject_id] = (minutesBySubject[s.subject_id] || 0) + s.duration;
            }
        });

        const sortedSubjects = Object.keys(minutesBySubject).sort((a,b) => minutesBySubject[b] - minutesBySubject[a]);

        let chartSVG = '<svg id="subject-pie-chart" viewBox="0 0 64 64">';
        let legendHTML = '<div class="pie-chart-legend">';
        let cumulativePercent = 0;

        sortedSubjects.forEach(subjectId => {
            const subject = getSubjectById(subjectId);
            if (!subject) return;

            const percent = (minutesBySubject[subjectId] / totalMinutes) * 100;
            const strokeDasharray = `${percent} ${100 - percent}`;
            const strokeDashoffset = -cumulativePercent;

            chartSVG += `<circle cx="32" cy="32" r="16" stroke="${subject.color}" stroke-dasharray="${strokeDasharray}" stroke-dashoffset="${strokeDashoffset}"></circle>`;
            
            legendHTML += `
                <div class="legend-item">
                    <div class="legend-color-box" style="background-color: ${subject.color}"></div>
                    <span class="legend-name">${subject.name}</span>
                    <span class="legend-percent">${percent.toFixed(1)}%</span>
                </div>
            `;
            
            cumulativePercent += percent;
        });

        chartSVG += '</svg>';
        legendHTML += '</div>';
        container.innerHTML = chartSVG + legendHTML;
    };

    const renderAchievements = () => {
        const grid = $('#achievements-grid');
        if(!grid) return;

        grid.innerHTML = Object.entries(ACHIEVEMENTS_CONFIG).map(([id, config]) => {
            const unlocked = state.achievements.includes(id);
            return `
                <div class="achievement-card ${unlocked ? 'unlocked' : ''}" title="${config.description}">
                    <svg class="icon" viewBox="0 0 24 24">${config.icon}</svg>
                    <h4>${config.name}</h4>
                    <p>${config.description}</p>
                </div>
            `;
        }).join('');
    };

    const updateGamificationState = async () => {
        // --- 1. Update Streak ---
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        
        if (state.streak.lastStudyDay !== today) {
            if (state.streak.lastStudyDay === yesterday) {
                state.streak.current++; // Continue streak
            } else {
                state.streak.current = 1; // New streak
            }
            state.streak.lastStudyDay = today;
            await supabase.from('profiles').update({ streak: state.streak }).eq('id', state.currentUser.id);
        }

        // --- 2. Check for new achievements ---
        const totalMinutes = state.sessions.reduce((sum, s) => sum + s.duration, 0);
        const totalSessions = state.sessions.length;
        const unlockedAchievements = new Set(state.achievements);
        let newAchievementUnlocked = false;

        Object.keys(ACHIEVEMENTS_CONFIG).forEach(id => {
            if (!unlockedAchievements.has(id)) {
                const config = ACHIEVEMENTS_CONFIG[id];
                const isUnlocked = config.condition({
                    sessions: state.sessions,
                    subjects: state.subjects,
                    streak: state.streak,
                    totalMinutes,
                    totalSessions
                });
                if (isUnlocked) {
                    unlockedAchievements.add(id);
                    newAchievementUnlocked = true;
                    showNotification("Achievement Unlocked!", { body: config.name });
                }
            }
        });

        if (newAchievementUnlocked) {
            state.achievements = Array.from(unlockedAchievements);
            await supabase.from('profiles').update({ achievements: state.achievements }).eq('id', state.currentUser.id);
            renderAchievements();
        }
    };
    
    // --- STUDY ROOM TIMER ---
    const updateRoomTimerDisplay = () => {
        if (!state.ui.currentRoomId) return;
        const minutes = String(Math.floor(state.room.timeRemaining / 60)).padStart(2, '0');
        const seconds = String(state.room.timeRemaining % 60).padStart(2, '0');
        $('#room-timer-display').textContent = `${minutes}:${seconds}`;
        if(state.room.isRunning) {
            document.title = `${minutes}:${seconds} - In Room`;
        }
    };
    
    const switchRoomTimerMode = (mode) => {
        if(state.room.isRunning) {
            pauseRoomTimer(true); // Auto-pause when switching
        }
        state.room.mode = mode;
        $$('#room-pomodoro-modes .pomodoro-mode').forEach(b => b.classList.remove('active'));
        $(`#room-pomodoro-modes .pomodoro-mode[data-mode="${mode}"]`).classList.add('active');
        state.room.timeRemaining = state.pomodoro.settings[mode] * 60; // Use main settings
        updateRoomTimerDisplay();
    };

    const startRoomTimer = () => {
        if (state.room.isRunning) return;
        state.room.isRunning = true;
        updatePresence('Focusing');
        $('#room-play-icon').style.display = 'none';
        $('#room-pause-icon').style.display = 'block';

        state.room.timerId = setInterval(() => {
            state.room.timeRemaining--;
            updateRoomTimerDisplay();
            if (state.room.timeRemaining <= 0) {
                finishRoomSession();
                playAlarm();
            }
        }, 1000);
    };

    const pauseRoomTimer = (internal = false) => {
        if (!state.room.isRunning) return;
        state.room.isRunning = false;
        if (!internal) updatePresence('Idle');
        clearInterval(state.room.timerId);
        state.room.timerId = null;
        $('#room-play-icon').style.display = 'block';
        $('#room-pause-icon').style.display = 'none';
    };

    const finishRoomSession = async () => {
        const durationSeconds = state.pomodoro.settings[state.room.mode] * 60;

        if (state.room.mode === 'focus' && durationSeconds > 60) {
            const session = {
                user_id: state.currentUser.id,
                subject_id: $('#room-subject').value || null,
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
        
        pauseRoomTimer();
        const nextMode = state.room.mode === 'focus' ? 'short' : 'focus';
        const notificationTitle = state.room.mode === 'focus' ? 'Focus complete!' : 'Break is over!';
        const notificationBody = nextMode === 'focus' ? 'Time to get back to work!' : 'Time for a short break!';
        showNotification(notificationTitle, { body: notificationBody });
        switchRoomTimerMode(nextMode);
    };

    const renderParticipants = (participants) => {
        const list = $('#participant-list');
        if (!list) return;

        const sortedParticipants = Object.values(participants).sort((a, b) => a.joinedAt - b.joinedAt);

        list.innerHTML = sortedParticipants.map((p, index) => `
            <li class="participant-item">
                <span class="participant-name">
                    ${p.user} ${index === 0 ? '<span class="host-badge">HOST</span>' : ''}
                </span>
                <span class="participant-status">${p.status}</span>
            </li>
        `).join('');
    };

    const renderSingleChatMessage = (message) => {
        const container = $('#chat-messages');
        const isSelf = message.user === state.profile.username;
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${isSelf ? 'self' : 'other'}`;
        messageEl.innerHTML = `
            ${!isSelf ? `<p class="message-sender">${message.user}</p>` : ''}
            <p>${message.text}</p>
        `;
        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
    };


    // --- UTILITIES ---
    const getSubjectById = (id) => state.subjects.find(s => s.id == id);
    const getSubjectNameById = (id) => getSubjectById(id)?.name;
    const formatMinutes = (minutes) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins > 0 ? `${mins}m` : ''}`;
    };
    const getStudyMinutesForMonth = (subjectId) => {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return state.sessions
            .filter(s => s.subject_id == subjectId && new Date(s.date) >= firstDay && new Date(s.date) <= lastDay)
            .reduce((sum, s) => sum + s.duration, 0);
    };
    const getStudyMinutesForDay = (date) => {
        const dateStr = date.toISOString().slice(0, 10);
        return state.sessions
            .filter(s => new Date(s.date).toISOString().slice(0, 10) === dateStr)
            .reduce((sum, s) => sum + s.duration, 0);
    };
    
    // --- NOTIFICATIONS & SOUND ---
    const playAlarm = () => {
        $('#alarm-sound').play().catch(e => console.error("Audio play failed:", e));
    };
    
    let notificationPermission = 'default';
    const requestNotificationPermission = () => {
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission().then(permission => {
                notificationPermission = permission;
            });
        } else if ('Notification' in window) {
            notificationPermission = Notification.permission;
        }
    };
    
    const showNotification = (title, options) => {
        if (notificationPermission === 'granted') {
            new Notification(title, options);
        }
    };

    // --- EVENT LISTENERS ---
    function setupEventListeners() {
        // --- Navigation ---
        document.body.addEventListener('click', e => {
            const target = e.target;
            const navLink = target.closest('.nav-link, .bottom-nav-link');
            if (navLink) {
                e.preventDefault();
                navigateToPage(navLink.dataset.page);
            }
        });
        $('.menu-toggle').addEventListener('click', toggleSidebar);
        $('.sidebar-overlay').addEventListener('click', toggleSidebar);

        // --- Auth ---
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
            else alert("Sign up successful! Please check your email to verify your account.");
        });
        $('#signin-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('#signin-email').value;
            const password = $('#signin-password').value;
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) $('#auth-error').textContent = error.message;
        });
        $('#logout-btn').addEventListener('click', handleSignOut);
        
        // --- Modals ---
        document.body.addEventListener('click', e => {
            const target = e.target;
            if (target.matches('.modal-close-btn, .modal-cancel-btn')) {
                hideAllModals();
            }
        });

        // --- Settings ---
        $('#dark-mode-toggle').addEventListener('change', async (e) => {
            state.settings.darkMode = e.target.checked;
            applySettings();
            await supabase.from('profiles').update({ settings: state.settings }).eq('id', state.currentUser.id);
        });
        $('#color-palette').addEventListener('click', async (e) => {
            const target = e.target;
            if (target.classList.contains('color-swatch')) {
                state.settings.accentTheme = target.dataset.color;
                applySettings();
                await supabase.from('profiles').update({ settings: state.settings }).eq('id', state.currentUser.id);
            }
        });
        
        // --- Subjects ---
        document.body.addEventListener('click', (e) => {
            const target = e.target;
            const addBtn = target.closest('#add-subject-btn, #subjects-fab');
            if (addBtn) {
                $('#subject-form').reset();
                $('#subject-id').value = '';
                $('#subject-modal-title').textContent = 'New Subject';
                $('#subject-color-picker .color-swatch.active')?.classList.remove('active');
                showModal('subject-modal');
            }
            const editBtn = target.closest('.edit-subject-btn');
            if (editBtn) {
                const subject = getSubjectById(editBtn.dataset.id);
                if (subject) {
                    $('#subject-id').value = subject.id;
                    $('#subject-name').value = subject.name;
                    $('#subject-goal').value = subject.goal;
                    $('#subject-modal-title').textContent = 'Edit Subject';
                    $('#subject-color-picker .color-swatch.active')?.classList.remove('active');
                    const swatch = $(`#subject-color-picker .color-swatch[style*="${subject.color}"]`);
                    if(swatch) swatch.classList.add('active');
                    showModal('subject-modal');
                }
            }
            const deleteBtn = target.closest('.delete-subject-btn');
            if (deleteBtn) {
                state.deleteContext = { type: 'subject', id: deleteBtn.dataset.id };
                $('#delete-modal-title').textContent = 'Delete Subject';
                $('#delete-modal-text').textContent = 'Are you sure you want to delete this subject? All associated sessions, notes, and reminders will be unlinked.';
                showModal('delete-modal');
            }
        });
        $('#subject-form').addEventListener('submit', handleSubjectForm);
        $('#subject-color-picker').addEventListener('click', e => {
            const target = e.target;
            if (target.classList.contains('color-swatch')) {
                $('#subject-color-picker .color-swatch.active')?.classList.remove('active');
                target.classList.add('active');
            }
        });

        // --- Notes ---
        document.body.addEventListener('click', e => {
            const target = e.target;
             if (target.closest('#new-note-btn')) {
                $('#note-form').reset();
                $('#note-id').value = '';
                $('#note-modal-title').textContent = 'New Note';
                $('#note-content-editor').innerHTML = '';
                showModal('note-modal');
            }
            const noteItem = target.closest('.note-item');
            if(noteItem) {
                state.ui.selectedNoteId = noteItem.dataset.id;
                renderNotes();
                if(window.innerWidth <= 992) {
                     $('#notes-layout').classList.add('viewing-note');
                }
            }
            if(target.closest('.back-to-list-btn')) {
                $('#notes-layout').classList.remove('viewing-note');
            }
            const editNoteBtn = target.closest('.edit-note-btn');
            if(editNoteBtn) {
                const note = state.notes.find(n => n.id == editNoteBtn.dataset.id);
                if(note) {
                    $('#note-id').value = note.id;
                    $('#note-title').value = note.title;
                    $('#note-subject').value = note.subject_id;
                    $('#note-content-editor').innerHTML = note.content;
                    $('#note-modal-title').textContent = 'Edit Note';
                    showModal('note-modal');
                }
            }
             const deleteNoteBtn = target.closest('.delete-note-btn');
            if (deleteNoteBtn) {
                state.deleteContext = { type: 'note', id: deleteNoteBtn.dataset.id };
                $('#delete-modal-title').textContent = 'Delete Note';
                $('#delete-modal-text').textContent = 'Are you sure you want to delete this note?';
                showModal('delete-modal');
            }
        });
        $('#note-form').addEventListener('submit', handleNoteForm);
        $('#notes-search-bar').addEventListener('input', renderNotes);
        $('.editor-toolbar').addEventListener('click', e => {
            const target = e.target;
            const command = target.closest('button')?.dataset.command;
            if(command) {
                document.execCommand(command, false, null);
                $('#note-content-editor').focus();
            }
        });

        // --- Reminders & Calendar ---
        document.body.addEventListener('click', async (e) => {
            const target = e.target;
            // Add from dashboard
            if (target.closest('#add-reminder-from-dash')) {
                 $('#reminder-form').reset();
                $('#reminder-id').value = '';
                $('#reminder-modal-title').textContent = 'New Reminder';
                $('#reminder-date').value = new Date().toISOString().slice(0, 10);
                showModal('reminder-modal');
            }
            // Add from calendar
            const dayCell = target.closest('.calendar-day');
            if (dayCell && !target.closest('.reminder-item-calendar')) {
                $('#reminder-form').reset();
                $('#reminder-id').value = '';
                $('#reminder-modal-title').textContent = 'New Reminder';
                $('#reminder-date').value = dayCell.dataset.date;
                showModal('reminder-modal');
            }
            // Edit from dashboard or calendar
            const editBtn = target.closest('.edit-reminder-btn, .reminder-item-calendar');
            if (editBtn) {
                const reminder = state.reminders.find(r => r.id == editBtn.dataset.reminderId);
                if(reminder) {
                     $('#reminder-id').value = reminder.id;
                     $('#reminder-title').value = reminder.title;
                     $('#reminder-subject').value = reminder.subject_id;
                     $('#reminder-date').value = reminder.date;
                     $('#reminder-modal-title').textContent = 'Edit Reminder';
                     showModal('reminder-modal');
                }
            }
            // Delete
            const deleteBtn = target.closest('.delete-reminder-btn');
            if(deleteBtn) {
                 state.deleteContext = { type: 'reminder', id: deleteBtn.dataset.reminderId };
                 $('#delete-modal-title').textContent = 'Delete Reminder';
                 $('#delete-modal-text').textContent = 'Are you sure you want to delete this reminder?';
                 showModal('delete-modal');
            }
            // Toggle complete
            const checkbox = target.closest('.reminder-checkbox');
            if (checkbox) {
                const reminder = state.reminders.find(r => r.id == checkbox.dataset.reminderId);
                if (reminder) {
                    reminder.completed = checkbox.checked;
                    renderDashboardReminders();
                    renderCalendar();
                    await supabase.from('reminders').update({ completed: reminder.completed }).eq('id', reminder.id);
                }
            }
        });
        $('#reminder-form').addEventListener('submit', handleReminderForm);
        $('#calendar-prev').addEventListener('click', () => {
            state.calendar.currentDate.setMonth(state.calendar.currentDate.getMonth() - 1);
            renderCalendar();
        });
        $('#calendar-next').addEventListener('click', () => {
            state.calendar.currentDate.setMonth(state.calendar.currentDate.getMonth() + 1);
            renderCalendar();
        });
        $('#calendar-today').addEventListener('click', () => {
            state.calendar.currentDate = new Date();
            renderCalendar();
        });
        
        // --- Pomodoro ---
        $$('.pomodoro-modes').forEach(el => {
            el.addEventListener('click', e => {
                const target = e.target;
                if (target.classList.contains('pomodoro-mode')) {
                    switchPomodoroMode(target.dataset.mode);
                }
            });
        });

        $('#play-pause-btn').addEventListener('click', () => state.pomodoro.isRunning ? pauseTimer() : startTimer());
        $('#reset-btn').addEventListener('click', resetTimer);
        $('#skip-btn').addEventListener('click', () => finishSession(true));
        
        $$('#setting-focus-time, #setting-short-break-time, #setting-long-break-time').forEach(el => {
            el.addEventListener('change', async (e) => {
                const target = e.target;
                const mode = target.id.split('-')[1];
                state.pomodoro.settings[mode] = parseInt(target.value, 10);
                await supabase.from('profiles').update({ settings: { ...state.settings, pomodoro: state.pomodoro.settings } }).eq('id', state.currentUser.id);
                renderPomodoroSettings();
                if (state.pomodoro.mode === mode) {
                    resetTimer(); // Reset if changing the current mode's time
                }
            });
        });
        
        // --- Exam ---
        document.body.addEventListener('click', e => {
            const target = e.target;
            if (target.closest('#exam-widget.no-exam')) {
                $('#exam-form').reset();
                $('#remove-exam-btn').style.display = 'none';
                showModal('exam-modal');
            }
             if (target.closest('#edit-exam-btn')) {
                if (state.nextExam) {
                    $('#exam-title').value = state.nextExam.title;
                    $('#exam-subject').value = state.nextExam.subject_id;
                    $('#exam-date').value = state.nextExam.date;
                    $('#remove-exam-btn').style.display = 'block';
                    showModal('exam-modal');
                }
            }
        });
        $('#exam-form').addEventListener('submit', handleExamForm);
        $('#remove-exam-btn').addEventListener('click', async () => {
            state.nextExam = null;
            await supabase.from('profiles').update({ next_exam: null }).eq('id', state.currentUser.id);
            renderNextExam();
            hideModal('exam-modal');
        });
        
        // --- Delete Confirmation ---
        $('#confirm-delete-btn').addEventListener('click', async () => {
            const { type, id } = state.deleteContext;
            if(type === 'subject') {
                await supabase.from('subjects').delete().eq('id', id);
                state.subjects = state.subjects.filter(s => s.id != id);
                renderSubjects();
                populateSubjectDropdowns();
            } else if (type === 'note') {
                await supabase.from('notes').delete().eq('id', id);
                state.notes = state.notes.filter(n => n.id != id);
                if(state.ui.selectedNoteId == id) state.ui.selectedNoteId = null;
                renderNotes();
            } else if (type === 'reminder') {
                await supabase.from('reminders').delete().eq('id', id);
                state.reminders = state.reminders.filter(r => r.id != id);
                renderDashboardReminders();
                renderCalendar();
            }
            hideModal('delete-modal');
        });

        // --- Log Session ---
        $('#confirm-log-session-btn').addEventListener('click', async () => {
            const { type, durationMinutes, subjectId } = state.logSessionContext;
            
            const session = {
                user_id: state.currentUser.id,
                subject_id: subjectId,
                duration: durationMinutes,
                date: new Date().toISOString()
            };
            const { data } = await supabase.from('sessions').insert(session).select().single();
            if (data) state.sessions.unshift(data);
            
            await updateGamificationState();

            renderSessions();
            renderSubjects();
            renderDashboardProgressWidget();
            
            state.logSessionContext = { type: null, durationMinutes: 0, subjectId: null };
            hideModal('log-session-modal');
        });

        // --- Study Rooms ---
        $('#join-room-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const input = $('#room-name-input');
            let roomName = input.value.trim();
            if (roomName) {
                // Sanitize room name: must be a string with no spaces or special characters
                const sanitizedRoomName = roomName
                    .toLowerCase()
                    .replace(/\s+/g, '-') // replace spaces with hyphens
                    .replace(/[^a-z0-9-]/g, ''); // remove invalid characters
                
                if(roomName !== sanitizedRoomName) {
                    input.value = sanitizedRoomName;
                    alert(`Room name sanitized to: "${sanitizedRoomName}". Invalid characters were removed.`);
                }
                joinRoom(sanitizedRoomName);
            }
        });
        $('#room-leave-btn').addEventListener('click', leaveRoom);
        $('#room-timer-controls').addEventListener('click', e => {
            const target = e.target;
            if (target.closest('#room-play-pause-btn')) {
                state.room.isRunning ? pauseRoomTimer() : startRoomTimer();
            }
        });
        $('#room-pomodoro-modes').addEventListener('click', e => {
            const target = e.target;
            if (target.classList.contains('pomodoro-mode')) {
                switchRoomTimerMode(target.dataset.mode);
            }
        });
        $('#chat-form').addEventListener('submit', e => {
            e.preventDefault();
            const input = $('#chat-input');
            if (input.value) {
                sendChatMessage(input.value);
                input.value = '';
            }
        });

        // --- Timer & Stopwatch ---
        $('#timer-start-btn').addEventListener('click', startCustomTimer);
        $('#timer-pause-btn').addEventListener('click', pauseCustomTimer);
        $('#timer-reset-btn').addEventListener('click', resetCustomTimer);

        $('#stopwatch-start-btn').addEventListener('click', startStopwatch);
        $('#stopwatch-stop-btn').addEventListener('click', stopStopwatch);
        $('#stopwatch-lap-btn').addEventListener('click', lapStopwatch);
        $('#stopwatch-reset-btn').addEventListener('click', resetStopwatch);

        // --- Analytics ---
        document.body.addEventListener('click', e => {
            if(e.target.closest('#view-analytics-btn')) {
                navigateToPage('analytics');
            }
        });

        // --- Gemini ---
        document.body.addEventListener('click', e => {
            if(e.target.closest('#suggest-break-btn')) {
                fetchBreakSuggestion();
            }
        })

    } // End setupEventListeners

    // --- INITIALIZATION ---
    async function init() {
        const loader = $('#app-loader');
        
        // --- Navigation Setup ---
        const navList = $('.sidebar .nav-list');
        const bottomNav = $('.bottom-nav');
        const moreNavList = $('#more-nav-list');

        // Clear existing items to prevent duplication on hot-reload scenarios
        navList.innerHTML = '';
        bottomNav.innerHTML = '';
        moreNavList.innerHTML = '';
        
        NAV_ITEMS.forEach(item => {
            const iconHTML = `<svg class="nav-icon" viewBox="0 0 24 24">${item.icon}</svg>`;
            
            // Main Sidebar (Desktop): Render all items except for the "More" placeholder
            if ((item.type === 'main' || item.type === 'secondary') && item.id !== 'more') {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `<a href="#" class="nav-link" data-page="${item.id}">${iconHTML}<span>${item.label}</span></a>`;
                navList.appendChild(li);
            }
            
            // Bottom Nav (Mobile): Render only main items
            if (item.type === 'main') {
                const link = document.createElement('a');
                link.href = "#";
                link.className = 'bottom-nav-link';
                link.dataset.page = item.id;
                link.innerHTML = `${iconHTML}<span class="nav-label">${item.label}</span>`;
                bottomNav.appendChild(link);
            }
            
            // More Page List (Mobile): Render only secondary items
            if (item.type === 'secondary') {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `<a href="#" class="nav-link" data-page="${item.id}">${iconHTML}<span>${item.label}</span></a>`;
                moreNavList.appendChild(li);
            }
        });

        setupEventListeners();
        createColorSwatches();

        supabase.auth.onAuthStateChange(async (_event, session) => {
            state.currentUser = session?.user;
            if (state.currentUser) {
                await loadAllDataForUser();
                hideLoginScreen();
            } else {
                showLoginScreen();
            }
             // Fade out loader once auth state is determined
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 500);
        });
    }

    init();
});
