import { old_type_dict } from './find-old-type-database.js';

const is_character_digit = (c) => { return c >= '0' && c <= '9' }

const getKeyAndNumber = (cardId) => {
    // TODO: get regexes to cooperate
    
    const card_set_id = cardId.split('-')[0]
    const card_dirty_number = cardId.split('-')[1]
    
    var card_prefix = ""
    var card_pure_number = ""
    var card_suffix = ""
    
    var stage = 0
    var c = 'a'
    for(let ic = 0; ic < card_dirty_number.length; ic++){
        c = card_dirty_number[ic];
        if(stage == 0){
            if(!is_character_digit(c)){
                card_prefix = card_prefix + c;
                continue;
            }
            // we know c is a number
            stage = 1;
        }
        if(stage == 1){
            if(is_character_digit(c)){
                card_pure_number = card_pure_number + c;
                continue;
            }
            // we know c is a number
            stage = 2;
        }
        // we know stage == 2
        card_suffix = card_suffix + c;
    }
        
    const card_key = card_set_id + '/' + card_prefix + '/' + card_suffix;
    
    if (card_pure_number == ''){
        return [card_key, 0];
    }
    
    return [card_key, parseInt(card_pure_number)];
}

export const getOldCardType = (cardId) => {
  // Find key and number
  const card_key_and_number = getKeyAndNumber(cardId)
  const card_key = card_key_and_number[0]
  const card_number = card_key_and_number[1]

  // Check if the key is in the dictionary
  if (card_key in old_type_dict) {
    const types = old_type_dict[card_key];
      
    // Check the edge case with card_number == 0
    if (card_number==0){
        if (0 in types){
            return types[0];
        }
        else{
            return 'Unknown';
        }
    }

    var index = 0
    for (index in types) {
      if (card_number < index) {
        return types[index];
      }
    }
  }

  // Default case if the card_key is not found or the card_number is too high
  return 'Unknown';
};
