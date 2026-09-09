-- First Auto card fees (fixed, transaction, magnetic media, interest, scrutiny) are posted to Bank Charges by branch (accountant: 4040-BRANCH)
update fleet_gl_map set gl_account = '404000', gl_name = 'Bank Charges - fleet card fees' where source = 'first_auto' and cost_type = 'fees';
update fleet_settings set value = '906000', description = 'First Auto / WesBank creditor (Acumatica 906000, same as Avis)' where key = 'fa_creditor_account' and value = '';
