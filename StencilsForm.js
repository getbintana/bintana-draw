/*
 * The downloader's window: a short curated list, the terms of the selected
 * set, and one request. It is a form rather than a dialog primitive because a
 * license is prose that has to stay on screen while the person decides.
 *
 * The download itself is `Http.Get`; the answer is handed to
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
        dialog.LstStencils.SetFocus();
        return dialog;
    }

    fill() {
        this.syncing = true;
        this.LstStencils.Clear();
        for (const entry of STENCIL_SETS)
            this.LstStencils.Add(entry.name + "  ·  " + entry.source, entry.id);
        if (STENCIL_SETS.length) this.LstStencils.Index = 0;
        this.syncing = false;
        this.refreshInfo();
    }

    current() {
        const index = this.LstStencils.Index;
        return index >= 0 && index < STENCIL_SETS.length
            ? STENCIL_SETS[index] : null;
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
            Locale.Text("Source: {0}", entry.source);
        this.BtnDownload.Enabled = !this.busy;
    }

    LstStencils_Select() {
        if (!this.syncing) this.refreshInfo();
    }

    LstStencils_Activate() { this.downloadSelected(); }

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
