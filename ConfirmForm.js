/*
 * The one question with three answers: save, discard or go back. A form
 * rather than a runtime primitive, and it only calls the callback of what the
 * person actually chose -- cancelling (the button, Escape or the frame) calls
 * neither, which is what leaves the caller's window open.
 */
"use strict";

export class ConfirmForm extends Form {

    static ask(title, message, saveText, onSave, discardText, onDiscard) {
        const dialog = new ConfirmForm();

        dialog.Text           = title;
        dialog.LblMessage.Text = message;
        dialog.BtnSave.Text   = saveText || Locale.Text("Save");
        dialog.onSave         = onSave;

        if (discardText) {
            dialog.BtnDiscard.Text    = discardText;
            dialog.BtnDiscard.Visible = true;
            dialog.onDiscard          = onDiscard;
        } else {
            dialog.BtnDiscard.Visible = false;
            dialog.BtnCancel.X        = 220;
            dialog.BtnCancel.Width    = 220;
        }

        dialog.Modal = true;
        dialog.Show();
        dialog.BtnCancel.SetFocus();
        return dialog;
    }

    BtnSave_Click() {
        this.Close();
        if (this.onSave) this.onSave();
    }

    BtnDiscard_Click() {
        this.Close();
        if (this.onDiscard) this.onDiscard();
    }

    BtnCancel_Click() { this.Close(); }
}
