export const stadiumArray = [];
export const stadiumElement = document.getElementById('stadiumElement');

// create global variable that holds the information of a selected card, i.e., the card that has been clicked and highlighted and can trigger keybinds
export const sCard = {
    index: 0,
    zoneArray: '',
    zoneArrayString: '',
    zoneElement: '',
    zoneElementString: '',
    oUser: '',
    user: '',
    box: '',
    boxParent: '',
    keybinds: false,
    get card(){
        if (this.zoneArray){
            return this.zoneArray[this.index];
        };
    }
};
// create global variable that holds the information of the target location, which could be a card or a zone
export const target = {
    index: 0,
    zoneArray: '',
    zoneArrayString: '',
    zoneElement: '',
    zoneElementString: '',
    get card(){
        if (this.zoneArray){
            return this.zoneArray[this.index];
        };
    }
};