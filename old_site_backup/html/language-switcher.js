document.addEventListener("DOMContentLoaded", function() {
    // Find the existing Radix UI language button
    const existingButton = document.querySelector('button[aria-haspopup="menu"]');
    
    if (existingButton) {
        // Get the current language from the button content
        const currentLangSpan = existingButton.querySelector('span:last-of-type');
        const currentLang = currentLangSpan ? currentLangSpan.textContent : 'EN';
        
        // Create a new custom button to replace the Radix UI button
        const customButton = document.createElement('button');
        customButton.className = existingButton.className;
        customButton.type = 'button';
        customButton.innerHTML = existingButton.innerHTML;
        
        // Remove Radix UI specific attributes
        customButton.removeAttribute('id');
        customButton.removeAttribute('aria-haspopup');
        customButton.removeAttribute('aria-expanded');
        customButton.removeAttribute('data-state');
        
        // Create dropdown menu
        const dropdown = document.createElement("div");
        dropdown.className = "language-dropdown";
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            background: #0f172a;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 8px 0;
            min-width: 120px;
            z-index: 1000;
            display: none;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            margin-top: 4px;
        `;
        
        // Determine if we are in a language subdirectory
        const onSubPage = window.location.pathname.includes('/ru/') ||
                          window.location.pathname.includes('/es/') ||
                          window.location.pathname.includes('/it/') ||
                          window.location.pathname.includes('/vi/');

        const languages = [
            { code: "en", name: "English", flag: "🇺🇸", path: onSubPage ? "../index.html" : "./index.html" },
            { code: "ru", name: "Русский", flag: "🇷🇺", path: onSubPage ? "../ru/index.html" : "./ru/index.html" },
            { code: "es", name: "Español", flag: "🇪🇸", path: onSubPage ? "../es/index.html" : "./es/index.html" },
            { code: "it", name: "Italiano", flag: "🇮🇹", path: onSubPage ? "../it/index.html" : "./it/index.html" },
            { code: "vi", name: "Tiếng Việt", flag: "🇻🇳", path: onSubPage ? "../vi/index.html" : "./vi/index.html" }
        ];

        // If on a language subpage, make its own link relative to current directory
        if(onSubPage) {
            if (window.location.pathname.includes('/ru/')) {
                languages.find(l => l.code === 'ru').path = './index.html';
            } else if (window.location.pathname.includes('/es/')) {
                languages.find(l => l.code === 'es').path = './index.html';
            } else if (window.location.pathname.includes('/it/')) {
                languages.find(l => l.code === 'it').path = './index.html';
            } else if (window.location.pathname.includes('/vi/')) {
                languages.find(l => l.code === 'vi').path = './index.html';
            }
        }
        
        languages.forEach(lang => {
            const option = document.createElement("a");
            option.href = lang.path;
            option.className = "language-option";
            option.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                color: white;
                text-decoration: none;
                transition: background-color 0.2s;
                font-size: 14px;
            `;
            option.innerHTML = `<span style="font-size: 16px;">${lang.flag}</span><span>${lang.name}</span>`;
            
            // Highlight current language
            if (lang.name.includes(currentLang) || (currentLang === 'EN' && lang.code === 'en')) {
                option.style.backgroundColor = "rgba(0, 245, 212, 0.1)";
                option.style.color = "#00F5D4";
            }
            
            option.addEventListener("mouseenter", () => {
                option.style.backgroundColor = "rgba(0, 245, 212, 0.1)";
            });
            
            option.addEventListener("mouseleave", () => {
                if (!(lang.name.includes(currentLang) || (currentLang === 'EN' && lang.code === 'en'))) {
                    option.style.backgroundColor = "transparent";
                }
            });
            
            dropdown.appendChild(option);
        });
        
        // Position dropdown relative to button
        customButton.style.position = "relative";
        customButton.appendChild(dropdown);
        
        // Toggle dropdown on click
        customButton.addEventListener("click", function(e) {
            e.stopPropagation();
            
            const isOpen = dropdown.style.display === "block";
            dropdown.style.display = isOpen ? "none" : "block";
        });
        
        // Handle clicks on language options
        dropdown.addEventListener('click', function (e) {
            if (e.target.closest('a')) {
                window.location.href = e.target.closest('a').href;
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener("click", function(e) {
            if (!customButton.contains(e.target)) {
                dropdown.style.display = "none";
            }
        });
        
        // Close dropdown on escape key
        document.addEventListener("keydown", function(e) {
            if (e.key === "Escape") {
                dropdown.style.display = "none";
            }
        });
        
        // Replace the existing button with our custom one
        existingButton.parentNode.replaceChild(customButton, existingButton);
        
        console.log("Custom language switcher initialized successfully!");
    } else {
        console.log("Language button not found");
    }
}); 