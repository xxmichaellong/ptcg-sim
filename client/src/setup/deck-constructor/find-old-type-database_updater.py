# This Python script updates find-old-type-database.js when ran.
# It's probably not necessary to run this often, as most new cards get imported
# through the Limitless set code anyway.

import json

# https://github.com/PokemonTCG/pokemon-tcg-data
# Clone this repository and set the following to the path you cloned it at
PATH_OF_CLONED_REPO = '../../../../../pokemon-tcg-data'

# Middle_dict stores the keys that will be used in the output file,
# but just stores the type of every card with that key.
#
# By the way the key will be setId/lettersBeforeNumber/lettersAfterNumber
middle_dict = {}

def get_card_key_and_number(card_id):
    # TODO: get regexes to cooperate
    
    NUMBERS = ['0','1','2','3','4','5','6','7','8','9']
    
    [card_set_id, card_dirty_number] = card_id.split('-')
    
    card_prefix = ""
    card_pure_number = ""
    card_suffix = ""
    
    stage = 0
    for c in card_dirty_number:
        if stage == 0:
            if c not in NUMBERS:
                card_prefix = card_prefix + c
                continue
            # we know c is a number
            stage = 1
        if stage == 1:
            if c in NUMBERS:
                card_pure_number = card_pure_number + c
                continue
            # we know c is not a number
            stage = 2
        # we know stage == 2
        card_suffix = card_suffix +c
        
    card_key = set_id + '/' + card_prefix + '/' + card_suffix
    
    if card_pure_number == '':
        return card_key, 0
    
    return card_key, int(card_pure_number)

sets = json.load(open(f"{PATH_OF_CLONED_REPO}/sets/en.json"))
for s in sets:
    set_id = s['id']
    
    set_data = json.load(open(f"{PATH_OF_CLONED_REPO}/cards/en/{set_id}.json"))
    
    for card in set_data:
        card_key, card_number = get_card_key_and_number(card['id'])
        if card_key not in middle_dict:
            middle_dict[card_key] = {}
            
        # sanity check to prevent cards somehow overwriting each other
        assert card_number not in middle_dict[card_key]
        
        middle_dict[card_key][card_number] = card['supertype']

# Now we start building the output dict, which works same as the stuff in find-type.js
output_dict = {}

for key in middle_dict:
    output_dict[key] = {}
    
    if 0 in middle_dict[key]:
        output_dict[key][0] = middle_dict[key][0]
    
    previous_type = 'Unknown'
    if 1 in middle_dict[key]:
        previous_type = middle_dict[key][1]
    for i in range(1,2+max([k for k in middle_dict[key]])):
        current_type = 'Unknown'
        if i in middle_dict[key]:
            current_type = middle_dict[key][i]
        if current_type != previous_type:
            output_dict[key][i] = previous_type
            previous_type = current_type

# alright, time to print our output
f = open("find-old-type-database.js","w")
f.write('// To update this, run find-old-type-database_updater.py\n\n')
f.write('export const old_type_dict = {\n')
for key in output_dict:
    f.write(f'  "{key}": ')
    f.write('{\n')
    for i in output_dict[key]:
        f.write(f'    {i}: "{output_dict[key][i]}",\n')
    f.write('  },\n')
f.write('}\n')
f.close()