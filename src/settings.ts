import { App, Notice, Setting, PluginSettingTab, TFile, SuggestModal } from 'obsidian';
import { DEFAULT_PROMPTS } from './defaultPrompts';
import type DeepInsightAI from './main';

export const InsertPositionEnum = {
    top: 'top',
    bottom: 'bottom',
    cursor: 'cursor'
} as const;

export const AnthropicModelEnum = {
    sonnet: 'claude-3-5-sonnet-latest',
    haiku: 'claude-3-5-haiku-latest'
} as const;

export type InsertPosition = typeof InsertPositionEnum[keyof typeof InsertPositionEnum];
export type AnthropicModel = typeof AnthropicModelEnum[keyof typeof AnthropicModelEnum];

export interface DeepInsightAISettings {
    apiKey: string;
    model: AnthropicModel;
    systemPromptPath: string;
    userPromptPath: string;
    combinationPromptPath: string;
    excludeFolders: string[];
    maxTokensPerRequest: number;
    insertPosition: InsertPosition;
    defaultSystemPrompt: string;
    defaultUserPrompt: string;
    defaultCombinationPrompt: string;
    retryAttempts: number;
    showCostSummary: boolean;
    testMode: {
        enabled: boolean;
        maxFiles?: number;
        maxTokens?: number;
    };
    showAdvancedSettings: boolean;
}

export class PromptNotesModal extends SuggestModal<TFile> {
    constructor(
        app: App,
        private plugin: DeepInsightAI,
        private onError: (error: Error) => void,
        private promptType: keyof Pick<DeepInsightAISettings, 'systemPromptPath' | 'userPromptPath' | 'combinationPromptPath'>,
        private onSelect?: () => void
    ) {
        super(app);
        this.setPlaceholder('Type to search notes by title or path...');
    }

    getSuggestions(query: string): TFile[] {
        const files = this.app.vault.getMarkdownFiles();
        const excludedFolders = this.plugin.settings.excludeFolders;
        
        return files
            .filter(file => !excludedFolders
                .some(folder => file.path.toLowerCase().startsWith(folder.toLowerCase())))
            .filter(file => {
                if (!query) {
                    return true;
                }
                
                const searchString = `${file.basename} ${file.path}`.toLowerCase();
                return query.toLowerCase().split(' ')
                    .every(term => searchString.contains(term));
            })
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        const container = el.createDiv({ cls: 'deep-insight-ai-file-suggestion' });
        
        container.createEl('span', {
            cls: 'nav-file-title-content',
            text: '📄 '
        });
        
        container.createEl('span', { 
            cls: 'deep-insight-ai-file-name',
            text: file.basename,
            attr: { style: 'font-weight: bold;' }
        });
        
        const pathText = file.parent ? ` (${file.parent.path})` : '';
        if (pathText) {
            container.createEl('span', { 
                cls: 'deep-insight-ai-file-path',
                text: pathText,
                attr: { style: 'color: var(--text-muted);' }
            });
        }
    }

    async onChooseSuggestion(file: TFile): Promise<void> {
        try {
            this.plugin.settings[this.promptType] = file.path;
            await this.plugin.saveSettings();
            
            const promptTypes = {
                systemPromptPath: 'System',
                userPromptPath: 'User',
                combinationPromptPath: 'Combination'
            };
            new Notice(`${promptTypes[this.promptType]} prompt set to: ${file.basename}`);
            this.onSelect?.();
            
        } catch (error) {
            this.onError(error instanceof Error ? error : new Error('Unknown error'));
        }
    }
}

export class DeepInsightAISettingTab extends PluginSettingTab {
    private advancedSettingsEl: HTMLElement | null = null;

    constructor(app: App, private plugin: DeepInsightAI) {
        super(app, plugin);
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
    
        this.displayBasicSettings(containerEl);
        this.displayPromptSettings(containerEl);
        this.displayAdvancedSettingsHeader(containerEl);
        
        if (this.plugin.settings.showAdvancedSettings && this.advancedSettingsEl) {
            this.advancedSettingsEl.style.display = 'block';
            this.displayAdvancedSettings(this.advancedSettingsEl);
        }
    }

    private displayBasicSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Anthropic API Key')
            .setDesc('Your Anthropic API key')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Model')
            .setDesc('Select Claude model to use')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    'claude-3-5-sonnet-latest': 'Claude 3.5 Sonnet (Balanced)',
                    'claude-3-5-haiku-latest': 'Claude 3.5 Haiku (Less Expensive)'
                })
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    if (isAnthropicModel(value)) {
                        this.plugin.settings.model = value;
                        await this.plugin.saveSettings();
                    }
                }));

        this.addBasicSettingOptions(containerEl);
    }

    private addBasicSettingOptions(containerEl: HTMLElement): void {
        this.addSettingOption(containerEl, 'Show Estimated API Cost', 
            'Display estimated cost when generating insights', 'showCostSummary');

        this.addInsertPositionSetting(containerEl);
        this.addExcludedFoldersSetting(containerEl);
    }

    private addSettingOption(
        containerEl: HTMLElement, 
        name: string, 
        desc: string, 
        settingKey: keyof DeepInsightAISettings,
        type: 'toggle' | 'text' = 'toggle'
    ): void {
        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc);

        if (type === 'toggle') {
            setting.addToggle(toggle => toggle
                .setValue(this.plugin.settings[settingKey] as boolean)
                .onChange(async (value) => {
                    (this.plugin.settings[settingKey] as boolean) = value;
                    await this.plugin.saveSettings();
                }));
        } else {
            setting.addText(text => text
                .setValue(String(this.plugin.settings[settingKey]))
                .onChange(async (value) => {
                    (this.plugin.settings[settingKey] as string) = value;
                    await this.plugin.saveSettings();
                }));
        }
    }

    private addInsertPositionSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Insert Position')
            .setDesc('Where to insert generated insights in the note')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    'top': 'At the top of the note',
                    'bottom': 'At the bottom of the note',
                    'cursor': 'At current cursor position'
                })
                .setValue(this.plugin.settings.insertPosition)
                .onChange(async (value) => {
                    if (isInsertPosition(value)) {
                        this.plugin.settings.insertPosition = value;
                        await this.plugin.saveSettings();
                    }
                }));
    }

    private addExcludedFoldersSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Excluded Folders')
            .setDesc('Comma-separated list of folders to exclude')
            .addText(text => text
                .setPlaceholder('templates,archive')
                .setValue(this.plugin.settings.excludeFolders.join(','))
                .onChange(async (value) => {
                    this.plugin.settings.excludeFolders = value.split(',').map(f => f.trim());
                    await this.plugin.saveSettings();
                }));
    }

    private async createPromptSection(
        containerEl: HTMLElement,
        title: string,
        description: string,
        pathSetting: keyof Pick<DeepInsightAISettings, 'systemPromptPath' | 'userPromptPath' | 'combinationPromptPath'>,
        defaultSetting: keyof Pick<DeepInsightAISettings, 'defaultSystemPrompt' | 'defaultUserPrompt' | 'defaultCombinationPrompt'>
    ): Promise<void> {
        const container = containerEl.createDiv({
            cls: 'deep-insight-ai-prompt-container'
        });
    
        container.createEl('h4', { text: title });
        container.createEl('p', { 
            text: description,
            cls: 'setting-item-description'
        });
    
        const notePath = this.plugin.settings[pathSetting];
        let noteContent = '';
    
        if (notePath) {
            try {
                const file = this.app.vault.getAbstractFileByPath(notePath);
                if (file instanceof TFile) {
                    noteContent = await this.app.vault.read(file);
                }
            } catch (error) {
                console.error(`Failed to read prompt note: ${error}`);
                new Notice(`Failed to read prompt note: ${error}`);
            }
        }

        await this.renderPromptUI(container, notePath, noteContent, title, pathSetting, defaultSetting);
    }

    private createNotePathUI(
        container: HTMLElement,
        notePath: string,
        title: string,
        pathSetting: keyof Pick<DeepInsightAISettings, 'systemPromptPath' | 'userPromptPath' | 'combinationPromptPath'>,
        defaultSetting: keyof Pick<DeepInsightAISettings, 'defaultSystemPrompt' | 'defaultUserPrompt' | 'defaultCombinationPrompt'>
    ): void {
        new Setting(container)
            .setName(title)
            .setDesc('Using custom prompt from:')
            .addText(text => {
                text.inputEl.value = notePath;
                text.inputEl.disabled = true;
                text.inputEl.addClass('deep-insight-ai-path-input');
                return text;
            })
            .addExtraButton(button => {
                button
                    .setIcon('link')
                    .setTooltip('Open note')
                    .onClick(async () => {
                        const file = this.app.vault.getAbstractFileByPath(notePath);
                        if (file instanceof TFile) {
                            const leaf = this.app.workspace.getLeaf();
                            if (leaf) {
                                await leaf.openFile(file);
                                new Notice('📝 Prompt opened in the background');
                            }
                        }
                    });
            })
            .addExtraButton(button => {
                button
                    .setIcon('x')
                    .setTooltip('Remove note')
                    .onClick(async () => {
                        this.plugin.settings[pathSetting] = '';
                        await this.plugin.saveSettings();
                        this.display();
                        new Notice(`${title} note removed`);
                    });
            });
    }

    private async renderPromptUI(
        container: HTMLElement,
        notePath: string,
        noteContent: string,
        title: string,
        pathSetting: keyof Pick<DeepInsightAISettings, 'systemPromptPath' | 'userPromptPath' | 'combinationPromptPath'>,
        defaultSetting: keyof Pick<DeepInsightAISettings, 'defaultSystemPrompt' | 'defaultUserPrompt' | 'defaultCombinationPrompt'>
    ): Promise<void> {
        // Note selection and reset buttons in a single line
        new Setting(container)
            .addButton(button => button
                .setButtonText(notePath ? 'Change Note' : 'Select Note')
                .onClick(() => {
                    new PromptNotesModal(
                        this.app,
                        this.plugin,
                        (error) => {
                            new Notice(`Failed to set prompt note: ${error.message}`);
                        },
                        pathSetting,
                        () => this.display()
                    ).open();
                }))
            .addButton(button => button
                .setButtonText('Reset to Default')
                .onClick(async () => {
                    this.plugin.settings[pathSetting] = '';
                    this.plugin.settings[defaultSetting] = DEFAULT_PROMPTS[this.getPromptType(defaultSetting)];
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice(`${title} reset to default`);
                }));

        if (notePath) {
            this.createNotePathUI(container, notePath, title, pathSetting, defaultSetting);
        }

        this.createPromptTextArea(container, notePath, noteContent, defaultSetting);
    }

    private getPromptType(defaultSetting: keyof Pick<DeepInsightAISettings, 'defaultSystemPrompt' | 'defaultUserPrompt' | 'defaultCombinationPrompt'>): keyof typeof DEFAULT_PROMPTS {
        switch (defaultSetting) {
            case 'defaultSystemPrompt':
                return 'system';
            case 'defaultUserPrompt':
                return 'user';
            case 'defaultCombinationPrompt':
                return 'combination';
        }
    }

    private createPromptTextArea(
        container: HTMLElement,
        notePath: string,
        noteContent: string,
        defaultSetting: keyof Pick<DeepInsightAISettings, 'defaultSystemPrompt' | 'defaultUserPrompt' | 'defaultCombinationPrompt'>
    ): void {
        const promptContainer = container.createDiv({
            cls: 'deep-insight-ai-prompt-textarea-container'
        });

        if (notePath) {
            promptContainer.createEl('div', {
                cls: 'deep-insight-ai-prompt-message',
                text: '💡 This prompt is managed through the linked note above. Click the note link to edit.'
            });
        }

        const textarea = promptContainer.createEl('textarea', {
            cls: 'deep-insight-ai-prompt-textarea'
        });

        textarea.value = notePath ? noteContent : this.plugin.settings[defaultSetting];
        textarea.disabled = !!notePath;
        textarea.placeholder = notePath 
            ? 'This prompt is managed through the linked note. Click the note link above to edit.'
            : 'Enter default prompt';

        textarea.addEventListener('change', async (e) => {
            if (!notePath) {
                const target = e.target as HTMLTextAreaElement;
                this.plugin.settings[defaultSetting] = target.value;
                await this.plugin.saveSettings();
            }
        });
    }

    private displayAdvancedSettingsHeader(containerEl: HTMLElement): void {
        const advancedHeader = containerEl.createEl('div', { 
            cls: 'deep-insight-ai-advanced-header'
        });

        advancedHeader.createEl('h3', { 
            text: 'Advanced Settings',
            cls: 'deep-insight-ai-advanced-title'
        });

        const chevron = advancedHeader.createEl('span', {
            cls: `deep-insight-ai-advanced-chevron ${this.plugin.settings.showAdvancedSettings ? 'open' : ''}`
        });

        this.advancedSettingsEl = containerEl.createDiv({
            cls: 'deep-insight-ai-advanced-section',
            attr: {
                style: this.plugin.settings.showAdvancedSettings ? 'display: block' : 'display: none'
            }
        });

        advancedHeader.addEventListener('click', () => this.toggleAdvancedSettings(chevron));
    }

    private async toggleAdvancedSettings(chevron: HTMLElement): Promise<void> {
        this.plugin.settings.showAdvancedSettings = !this.plugin.settings.showAdvancedSettings;
        await this.plugin.saveSettings();
        
        chevron.classList.toggle('open');
        if (this.advancedSettingsEl) {
            if (this.plugin.settings.showAdvancedSettings) {
                this.advancedSettingsEl.style.display = 'block';
                this.displayAdvancedSettings(this.advancedSettingsEl);
            } else {
                this.advancedSettingsEl.style.display = 'none';
            }
        }
    }

    private displayAdvancedSettings(containerEl: HTMLElement): void {
        containerEl.empty();
        this.createAdvancedSettingsDescription(containerEl);
        this.createTestModeSettings(containerEl);
        this.createPerformanceSettings(containerEl);
    }

    private createAdvancedSettingsDescription(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            text: 'Advanced settings are for development and testing purposes. Use with caution.',
            cls: 'deep-insight-ai-advanced-description'
        });
    }

    private createTestModeSettings(containerEl: HTMLElement): void {
        const testModeContainer = containerEl.createDiv('test-mode-settings');
        
        new Setting(testModeContainer)
            .setName('Test Mode')
            .setDesc('Limit processing for testing and development purposes to a single chunk')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.testMode.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.testMode.enabled = value;
                    await this.plugin.saveSettings();
                    
                    const testModeOptions = testModeContainer.querySelector('.test-mode-options');
                    if (testModeOptions instanceof HTMLElement) {
                        testModeOptions.style.display = value ? 'block' : 'none';
                    }
                }));

        this.createTestModeOptions(testModeContainer);
    }

    private createTestModeOptions(container: HTMLElement): void {
        const testModeOptions = container.createDiv({
            cls: 'test-mode-options',
            attr: {
                style: this.plugin.settings.testMode.enabled ? 'display: block' : 'display: none'
            }
        });

        new Setting(testModeOptions)
            .setName('Maximum Files')
            .setDesc('Maximum number of files to process in test mode (0 for no limit)')
            .addText(text => text
                .setPlaceholder('5')
                .setValue(String(this.plugin.settings.testMode.maxFiles ?? ''))
                .onChange(async (value) => {
                    const numValue = parseInt(value);
                    this.plugin.settings.testMode.maxFiles = isNaN(numValue) ? undefined : numValue;
                    await this.plugin.saveSettings();
                }));

        new Setting(testModeOptions)
            .setName('Maximum Tokens')
            .setDesc('Maximum tokens per request in test mode (0 for no limit)')
            .addText(text => text
                .setPlaceholder('1000')
                .setValue(String(this.plugin.settings.testMode.maxTokens ?? ''))
                .onChange(async (value) => {
                    const numValue = parseInt(value);
                    this.plugin.settings.testMode.maxTokens = isNaN(numValue) ? undefined : numValue;
                    await this.plugin.saveSettings();
                }));
    }

    private createPerformanceSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Retry Attempts')
            .setDesc('Number of times to retry failed API requests')
            .addText(text => text
                .setPlaceholder('2')
                .setValue(String(this.plugin.settings.retryAttempts))
                .onChange(async (value) => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue >= 0) {
                        this.plugin.settings.retryAttempts = numValue;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Maximum Tokens Per Request')
            .setDesc('Maximum tokens to process in a single API request')
            .addText(text => text
                .setPlaceholder('90000')
                .setValue(String(this.plugin.settings.maxTokensPerRequest))
                .onChange(async (value) => {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue > 0) {
                        this.plugin.settings.maxTokensPerRequest = numValue;
                        await this.plugin.saveSettings();
                    }
                }));
    }

    private async displayPromptSettings(containerEl: HTMLElement): Promise<void> {
        containerEl.createEl('h3', { text: 'Prompts Configuration' });

        await Promise.all([
            this.createPromptSection(
                containerEl,
                'System Prompt',
                'Defines how the AI should process notes',
                'systemPromptPath',
                'defaultSystemPrompt'
            ),
            this.createPromptSection(
                containerEl,
                'User Prompt',
                'Defines what specific insight to generate',
                'userPromptPath',
                'defaultUserPrompt'
            ),
            this.createPromptSection(
                containerEl,
                'Combination Prompt',
                'Defines how to merge and organize tasks from multiple chunks',
                'combinationPromptPath',
                'defaultCombinationPrompt'
            )
        ]);
    }
}

export function isAnthropicModel(value: string): value is AnthropicModel {
    return Object.values(AnthropicModelEnum).includes(value as AnthropicModel);
}

export function isInsertPosition(value: string): value is InsertPosition {
    return Object.values(InsertPositionEnum).includes(value as InsertPosition);
}