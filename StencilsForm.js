/*
 * The downloader's window: a curated tree grouped by what the sets are for,
 * the terms of the selected set, and one request. The filter reads names and
 * the shape words in each set, so "AND" finds the logic gates. It is a form
 * rather than a dialog primitive because a license is prose that has to stay
 * on screen while the person decides.
 *
 * The download itself is the form's `HttpClient` part; the answer is handed to
 * `importLibraryText`, the same importer the file chooser uses, so a set from
 * the network and a set from disk cannot drift apart.
 */
"use strict";

export class StencilsForm extends Form {

    onItems = null;
    busy = false;
    syncing = false;

    static show(onItems) {
        const dialog = new StencilsForm();
        dialog.onItems = onItems;
        dialog.fill();
        dialog.Modal = true;
        dialog.Show();
        dialog.TrvStencils.SetFocus();
        return dialog;
    }

    matches(entry, query) {
        if (!query) return true;
        const words = [entry.name, entry.group, entry.source,
                       entry.keywords, entry.license].join(" ");
        return words.toLowerCase().indexOf(query) >= 0;
    }

    fill() {
        const query = (this.TxtFilter.Text || "").trim().toLowerCase();
        const previous = this.TrvStencils.Key;
        let first = "";

        this.syncing = true;
        this.TrvStencils.Clear();
        for (const entry of STENCIL_SETS) {
            if (!this.matches(entry, query)) continue;
            const group = "group:" + entry.group;
            if (!this.TrvStencils.Exists(group))
                this.TrvStencils.Add(group, entry.group);
            const key = "set:" + entry.id;
            this.TrvStencils.Add(key, entry.name + "  ·  " + entry.source, group);
            if (!first) first = key;
        }
        this.TrvStencils.ExpandAll();
        if (previous && previous.indexOf("set:") === 0 &&
            this.TrvStencils.Exists(previous))
            this.TrvStencils.Key = previous;
        else if (first)
            this.TrvStencils.Key = first;
        this.syncing = false;

        if (!first) {
            this.LblLicense.Text = Locale.Text("No set matches “{0}”.", query);
            this.BtnDownload.Enabled = false;
        } else {
            this.refreshInfo();
        }
    }

    current() {
        const key = this.TrvStencils.Key;
        if (!key || key.indexOf("set:") !== 0) return null;
        const id = key.slice(4);
        for (const entry of STENCIL_SETS)
            if (entry.id === id) return entry;
        return null;
    }

    refreshInfo() {
        const entry = this.current();
        if (!entry) {
            this.LblLicense.Text = Locale.Text("Select a set to see its license.");
            this.BtnDownload.Enabled = false;
            return;
        }
        this.LblLicense.Text =
            Locale.Text("License: {0}", entry.license) + "\n" +
            entry.licenseUrl + "\n" +
            Locale.Text("Source: {0}", entry.source) + "\n" +
            Locale.Text("Contains: {0}", entry.keywords);
        this.BtnDownload.Enabled = !this.busy;
    }

    TxtFilter_Change() { this.fill(); }

    TrvStencils_Select() {
        if (!this.syncing) this.refreshInfo();
    }

    TrvStencils_Activate() { this.downloadSelected(); }

    BtnDownload_Click() { this.downloadSelected(); }

    downloadSelected() {
        const entry = this.current();
        if (!entry || this.busy) return;

        this.busy = true;
        this.BtnDownload.Enabled = false;
        this.BtnClose.Enabled = false;
        this.LblStatus.Text = Locale.Text("Downloading {0}…", entry.name);

        this.Api.Get(entry.url, {},
            (answer) => this.downloaded(entry, answer),
            (error) => this.downloadFailed(entry, error.Message || error.message));
    }

    downloaded(entry, answer) {
        if (answer.Status < 200 || answer.Status >= 300) {
            this.downloadFailed(entry,
                                answer.Reason || ("HTTP " + answer.Status));
            return;
        }

        let items;
        try {
            items = importLibraryText(answer.Body.ToText(), entry.extension);
        } catch (e) {
            this.downloadFailed(entry, e.message);
            return;
        }
        if (!items.length) {
            this.downloadFailed(entry, Locale.Text("The library is empty."));
            return;
        }

        if (this.onItems) this.onItems(items, entry);
        this.finish();
        this.LblStatus.Text = Locale.Text("Added {0} shapes from {1}.",
                                          items.length, entry.name);
    }

    downloadFailed(entry, message) {
        this.finish();
        this.LblStatus.Text = Locale.Text("Cannot download {0}: {1}",
                                          entry.name, message);
    }

    finish() {
        this.busy = false;
        this.BtnDownload.Enabled = true;
        this.BtnClose.Enabled = true;
    }

    BtnClose_Click() {
        if (!this.busy) this.Close();
    }

    Form_Close() { return this.busy; }
}
